const { Client } = require('pg');
const { loadDbConfig } = require('./loadDbConfig');
const { allocateKwhAcrossBuckets } = require('./ohmePowerUtils');

const dbConfig = loadDbConfig();

function parseArgs(argv) {
    const args = { limit: 100, useOctopusApi: false, assumedRateP: 7.0 };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];

        if (token === '--limit' && next) {
            const parsed = Number(next);
            if (Number.isFinite(parsed) && parsed > 0) args.limit = Math.floor(parsed);
        }

        if (token === '--use-octopus-api') {
            args.useOctopusApi = true;
        }

        if (token === '--assumed-rate-p' && next) {
            const parsed = Number(next);
            if (Number.isFinite(parsed) && parsed > 0) args.assumedRateP = parsed;
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

async function ensureTables(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS ohme_charge_event_group_price_intervals (
            id BIGSERIAL PRIMARY KEY,
            group_id BIGINT NOT NULL REFERENCES ohme_charge_event_groups(id) ON DELETE CASCADE,
            interval_start TIMESTAMPTZ NOT NULL,
            interval_end TIMESTAMPTZ NOT NULL,
            energy_kwh NUMERIC(12, 6) NOT NULL,
            unit_rate_p_per_kwh NUMERIC(12, 6),
            cost_gbp NUMERIC(12, 6) NOT NULL DEFAULT 0,
            tariff_code TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (group_id, interval_start)
        );
    `);
}

async function runPricing(options = {}) {
    const limit = options.limit ?? 100;
    const useOctopusApi = Boolean(options.useOctopusApi);
    const assumedRateP = Number(options.assumedRateP ?? 7.0);

    const client = new Client(dbConfig);
    await client.connect();

    let getElectricUnitRatesForPeriod = null;
    if (useOctopusApi) {
        ({ getElectricUnitRatesForPeriod } = require('./tariffRates'));
    }

    try {
        await ensureTables(client);

        const groupsResult = await client.query(
            `SELECT id, group_started, group_ended, energy_kwh
             FROM ohme_charge_event_groups
             WHERE group_ended IS NOT NULL
             ORDER BY group_started DESC
             LIMIT $1`,
            [limit]
        );

        const groups = groupsResult.rows.reverse();
        let pricedCount = 0;

        for (const group of groups) {
            const buckets = allocateKwhAcrossBuckets(group.group_started, group.group_ended, Number(group.energy_kwh || 0));
            if (!buckets.length) continue;

            const rates = useOctopusApi
                ? await getElectricUnitRatesForPeriod(
                    new Date(group.group_started).toISOString(),
                    new Date(group.group_ended).toISOString()
                )
                : [];

            await client.query('BEGIN');
            try {
                await client.query('DELETE FROM ohme_charge_event_group_price_intervals WHERE group_id = $1', [group.id]);

                let totalCost = 0;

                for (const bucket of buckets) {
                    const rate = useOctopusApi ? pickRateForBucket(rates, bucket.interval_start) : null;
                    const unitRateP = useOctopusApi
                        ? Number(rate?.value_exc_vat ?? rate?.value_inc_vat ?? assumedRateP)
                        : assumedRateP;
                    const costGbp = Number(((bucket.ohme_kwh * unitRateP) / 100).toFixed(6));
                    totalCost += costGbp;

                    await client.query(
                        `INSERT INTO ohme_charge_event_group_price_intervals (
                            group_id, interval_start, interval_end, energy_kwh, unit_rate_p_per_kwh, cost_gbp, tariff_code
                         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                        [
                            group.id,
                            bucket.interval_start.toISOString(),
                            bucket.interval_end.toISOString(),
                            bucket.ohme_kwh,
                            unitRateP,
                            costGbp,
                            rate?.tariff_code || null
                        ]
                    );
                }

                await client.query(
                    `UPDATE ohme_charge_event_groups
                     SET estimated_cost_gbp = $1,
                         assumed_rate_p_per_kwh = $2,
                         assumed_cost_gbp = ROUND((energy_kwh * $2 / 100.0)::numeric, 6),
                         pricing_source = $3,
                         updated_at = NOW()
                     WHERE id = $4`,
                    [
                        Number(totalCost.toFixed(6)),
                        assumedRateP,
                        useOctopusApi ? 'octopus_api_fallback_assumed' : 'assumed_flat_7p',
                        group.id
                    ]
                );

                await client.query('COMMIT');
                pricedCount += 1;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }

        console.log(`Pricing complete. groups_seen=${groups.length} groups_priced=${pricedCount} source=${useOctopusApi ? 'octopus_api+assumed_fallback' : 'assumed_flat'} assumed_rate_p=${assumedRateP}`);
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    const args = parseArgs(process.argv);
    runPricing(args).catch((error) => {
        console.error('Failed to price grouped Ohme events:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { runPricing };
