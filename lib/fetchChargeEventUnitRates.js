const { Client } = require('pg');
const Table = require('cli-table3');

const { loadDbConfig } = require('./loadDbConfig');
const { allocateKwhAcrossBuckets } = require('./ohmePowerUtils');
const { getElectricUnitRatesForPeriod } = require('./tariffRates');

const dbConfig = loadDbConfig();


async function ensureOhmeTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS ohme_charge_events (
            id BIGSERIAL PRIMARY KEY,
            charge_started TIMESTAMPTZ NOT NULL,
            charge_ended TIMESTAMPTZ NOT NULL,
            duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
            kwh_estimated NUMERIC(12, 6) NOT NULL DEFAULT 0,
            cross_checked BOOLEAN NOT NULL DEFAULT FALSE,
            price NUMERIC(12, 6),
    vehicle TEXT NOT NULL DEFAULT 'unknown' CHECK (vehicle IN ('Audi', 'BMW', 'unknown')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (charge_started, charge_ended)
        );
    `);
}

function pickRateForBucket(rates, intervalStart) {
    const ts = new Date(intervalStart).getTime();

    return rates.find((rate) => {
        const start = new Date(rate.valid_from).getTime();
        const end = rate.valid_to ? new Date(rate.valid_to).getTime() : Number.MAX_SAFE_INTEGER;
        return ts >= start && ts < end;
    }) || null;
}

async function fetchRecentEvents(client, limit = 8) {
    const result = await client.query(
        `SELECT id, charge_started, charge_ended, kwh_estimated
         FROM ohme_charge_events
         WHERE charge_ended IS NOT NULL
         ORDER BY charge_started DESC
         LIMIT $1`,
        [limit]
    );

    return result.rows.reverse();
}

async function run() {
    const client = new Client(dbConfig);
    await client.connect();

    try {
        await ensureOhmeTable(client);
        const events = await fetchRecentEvents(client, 8);

        if (events.length === 0) {
            console.log('No rows found in ohme_charge_events. Run npm run ha:store:ohme_power first.');
            return;
        }

        for (const event of events) {
            const buckets = allocateKwhAcrossBuckets(event.charge_started, event.charge_ended, event.kwh_estimated);

            if (buckets.length === 0) {
                continue;
            }

            const rates = await getElectricUnitRatesForPeriod(
                new Date(event.charge_started).toISOString(),
                new Date(event.charge_ended).toISOString()
            );

            console.log(`\nCharge Event #${event.id} | ${new Date(event.charge_started).toISOString()} -> ${new Date(event.charge_ended).toISOString()}`);

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
    run().catch((error) => {
        console.error('Failed to fetch charge-event unit rates:', error.message);
        process.exitCode = 1;
    });
}
