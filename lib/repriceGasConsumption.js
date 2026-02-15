const { Client } = require('pg');
const { loadDbConfig } = require('./loadDbConfig');
const { getGasUnitRatesForPeriod } = require('./tariffRates');

const dbConfig = loadDbConfig();

function roundToNearest(value, precision) {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
}

function findMatchingRate(rates, timestamp) {
    const ts = new Date(timestamp).getTime();

    return rates.find((rate) => {
        const rateStart = new Date(rate.valid_from).getTime();
        const rateEnd = rate.valid_to ? new Date(rate.valid_to).getTime() : Infinity;
        return ts >= rateStart && ts < rateEnd;
    });
}

async function repriceGasConsumption(startIso, endIso, options = {}) {
    const { dryRun = false } = options;
    const client = new Client(dbConfig);

    const summary = {
        period: { start: startIso, end: endIso },
        dry_run: dryRun,
        total_rows: 0,
        repriced_rows: 0,
        unchanged_rows: 0,
        missing_rate_rows: 0,
        unmatched_intervals: []
    };

    try {
        await client.connect();

        const usageQuery = `
            SELECT id, consumption_kwh, price_pence, start_time
            FROM gas_consumption
            WHERE start_time >= $1 AND start_time < $2
            ORDER BY start_time;
        `;

        const usageResult = await client.query(usageQuery, [startIso, endIso]);
        const usageRows = usageResult.rows;

        summary.total_rows = usageRows.length;

        if (usageRows.length === 0) {
            return summary;
        }

        const rates = await getGasUnitRatesForPeriod(startIso, endIso);

        if (rates.length === 0) {
            throw new Error('No gas unit rates returned for requested period.');
        }

        if (!dryRun) {
            await client.query('BEGIN');
        }

        for (const row of usageRows) {
            const rate = findMatchingRate(rates, row.start_time);

            if (!rate) {
                summary.missing_rate_rows += 1;
                summary.unmatched_intervals.push(new Date(row.start_time).toISOString());
                continue;
            }

            const roundedConsumption = roundToNearest(Number(row.consumption_kwh), 2);
            const newPrice = roundToNearest(roundedConsumption * Number(rate.value_inc_vat), 2);
            const oldPrice = row.price_pence === null ? null : Number(row.price_pence);

            if (oldPrice !== null && Math.abs(oldPrice - newPrice) < 0.0001) {
                summary.unchanged_rows += 1;
                continue;
            }

            if (!dryRun) {
                await client.query(
                    'UPDATE gas_consumption SET price_pence = $1 WHERE id = $2',
                    [newPrice, row.id]
                );
            }

            summary.repriced_rows += 1;
        }

        if (!dryRun) {
            await client.query('COMMIT');
        }

        return summary;
    } catch (error) {
        if (!dryRun) {
            await client.query('ROLLBACK');
        }
        throw error;
    } finally {
        await client.end();
    }
}

module.exports = { repriceGasConsumption };
