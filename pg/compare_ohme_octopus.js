const { Client } = require('pg');
const Table = require('cli-table3');

const { loadDbConfig } = require('../lib/loadDbConfig');
const { allocateKwhAcrossBuckets } = require('../lib/ohmePowerUtils');

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
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (charge_started, charge_ended)
        );
    `);
}

async function fetchRecentChargeEvents(client, limit = 8) {
    const result = await client.query(
        `SELECT id, charge_started, charge_ended, duration_minutes, kwh_estimated
         FROM ohme_charge_events
         WHERE charge_ended IS NOT NULL
         ORDER BY charge_started DESC
         LIMIT $1`,
        [limit]
    );

    return result.rows.reverse();
}

async function fetchOctopusKwhForInterval(client, intervalStart, intervalEnd) {
    const result = await client.query(
        `SELECT COALESCE(SUM(consumption_kwh), 0) AS octopus_kwh
         FROM electric_consumption
         WHERE start_time >= $1 AND end_time <= $2`,
        [intervalStart.toISOString(), intervalEnd.toISOString()]
    );

    return Number(result.rows[0].octopus_kwh || 0);
}

async function runComparison() {
    const client = new Client(dbConfig);
    await client.connect();

    try {
        await ensureOhmeTable(client);
        const events = await fetchRecentChargeEvents(client, 8);

        if (events.length === 0) {
            console.log('No rows found in ohme_charge_events. Run npm run ha:store:ohme_power first.');
            return;
        }

        for (const event of events) {
            const buckets = allocateKwhAcrossBuckets(event.charge_started, event.charge_ended, event.kwh_estimated);

            console.log(`\nCharge Event #${event.id} | ${new Date(event.charge_started).toISOString()} -> ${new Date(event.charge_ended).toISOString()} | duration=${event.duration_minutes}m | kWh=${event.kwh_estimated}`);

            const table = new Table({
                head: ['Interval (start/end)', 'Ohme Power Used (kWh)', 'Octopus Power Used (kWh)', 'Differential (kWh)'],
                colWidths: [55, 24, 27, 20]
            });

            for (const bucket of buckets) {
                const octopusKwh = await fetchOctopusKwhForInterval(client, bucket.interval_start, bucket.interval_end);
                const differential = Number((bucket.ohme_kwh - octopusKwh).toFixed(6));

                table.push([
                    `${bucket.interval_start.toISOString()} -> ${bucket.interval_end.toISOString()}`,
                    Number(bucket.ohme_kwh.toFixed(6)),
                    Number(octopusKwh.toFixed(6)),
                    differential
                ]);
            }

            console.log(table.toString());
        }
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    runComparison().catch((error) => {
        console.error('Failed to compare Ohme and Octopus intervals:', error.message);
        process.exitCode = 1;
    });
}
