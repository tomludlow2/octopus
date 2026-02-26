const { Client } = require('pg');
const Table = require('cli-table3');

const { loadDbConfig } = require('./loadDbConfig');
const { allocateKwhAcrossBuckets } = require('./ohmePowerUtils');
const { getElectricUnitRatesForPeriod } = require('./tariffRates');

const dbConfig = loadDbConfig();

function parseArgs(argv) {
    const args = { limit: 8 };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];

        if (token === '--limit' && next) {
            const parsed = Number(next);
            if (Number.isFinite(parsed) && parsed > 0) {
                args.limit = Math.floor(parsed);
            }
        }
    }

    return args;
}

function pickRateForBucket(rates, intervalStart) {
    const ts = new Date(intervalStart).getTime();

    return rates.find((rate) => {
        const start = new Date(rate.valid_from).getTime();
        const end = rate.valid_to ? new Date(rate.valid_to).getTime() : Number.MAX_SAFE_INTEGER;
        return ts >= start && ts < end;
    }) || null;
}

async function fetchRecentLegacyEvents(client, limit = 8) {
    const result = await client.query(
        `SELECT id, start_time, end_time, energy_used
         FROM charging_events
         WHERE end_time IS NOT NULL
         ORDER BY start_time DESC
         LIMIT $1`,
        [limit]
    );

    return result.rows.reverse();
}

async function run(limit = 8) {
    const client = new Client(dbConfig);
    await client.connect();

    try {
        const events = await fetchRecentLegacyEvents(client, limit);

        if (events.length === 0) {
            console.log('No rows found in charging_events.');
            return;
        }

        for (const event of events) {
            const totalKwh = Number(event.energy_used || 0);
            const buckets = allocateKwhAcrossBuckets(event.start_time, event.end_time, totalKwh);

            if (buckets.length === 0) {
                continue;
            }

            const rates = await getElectricUnitRatesForPeriod(
                new Date(event.start_time).toISOString(),
                new Date(event.end_time).toISOString()
            );

            console.log(`\nLegacy Charge Event #${event.id} | ${new Date(event.start_time).toISOString()} -> ${new Date(event.end_time).toISOString()} | energy_used=${event.energy_used ?? 'null'}`);

            const table = new Table({
                head: ['Charge Bucket', 'kWh used in Bucket', 'Unit rate for Bucket (p/kWh)'],
                colWidths: [60, 22, 30]
            });

            for (const bucket of buckets) {
                const rate = pickRateForBucket(rates, bucket.interval_start);
                const pPerKwh = rate
                    ? (rate.value_exc_vat ?? rate.value_inc_vat ?? null)
                    : null;

                table.push([
                    `${bucket.interval_start.toISOString()} -> ${bucket.interval_end.toISOString()}`,
                    Number(bucket.ohme_kwh.toFixed(6)),
                    pPerKwh === null ? 'N/A' : Number(Number(pPerKwh).toFixed(6))
                ]);
            }

            console.log(table.toString());
        }
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    const args = parseArgs(process.argv);
    run(args.limit).catch((error) => {
        console.error('Failed to fetch legacy charge-event unit rates:', error.message);
        process.exitCode = 1;
    });
}
