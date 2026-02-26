const { Client } = require('pg');
const Table = require('cli-table3');

const { loadDbConfig } = require('./loadDbConfig');
const {
    loadHaConfig,
    fetchEntityHistory,
    analyzePowerEvents
} = require('./ohmePowerUtils');

const dbConfig = loadDbConfig();

async function ensureTable(client) {
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

    await client.query('CREATE INDEX IF NOT EXISTS idx_ohme_charge_events_started ON ohme_charge_events (charge_started DESC);');
}

async function upsertSessions(client, sessions) {
    let inserted = 0;
    let updated = 0;

    for (const session of sessions) {
        if (!session.end) {
            continue;
        }

        const result = await client.query(
            `INSERT INTO ohme_charge_events (
                charge_started,
                charge_ended,
                duration_minutes,
                kwh_estimated,
                cross_checked,
                price,
                updated_at
            ) VALUES ($1, $2, $3, $4, FALSE, NULL, NOW())
            ON CONFLICT (charge_started, charge_ended)
            DO UPDATE SET
                duration_minutes = EXCLUDED.duration_minutes,
                kwh_estimated = EXCLUDED.kwh_estimated,
                updated_at = NOW()
            RETURNING (xmax = 0) AS inserted`,
            [
                session.start.toISOString(),
                session.end.toISOString(),
                session.duration_minutes,
                session.kwh_estimated
            ]
        );

        if (result.rows[0].inserted) inserted += 1;
        else updated += 1;
    }

    return { inserted, updated };
}

async function storeOhmePowerEvents(days = 7) {
    const haConfig = loadHaConfig();
    const entityId = 'sensor.ohme_epod_power';
    const { startTime, endTime, rows } = await fetchEntityHistory({ ...haConfig, entityId, days });
    const { sessions, totalEstimatedKwh } = analyzePowerEvents(rows);

    const completedSessions = sessions.filter((session) => session.end);

    const client = new Client(dbConfig);
    await client.connect();

    try {
        await ensureTable(client);
        const { inserted, updated } = await upsertSessions(client, completedSessions);

        console.log(`Fetched ${rows.length} HA rows for ${entityId}`);
        console.log(`Window: ${startTime.toISOString()} -> ${endTime.toISOString()}`);
        console.log(`Sessions inferred: total=${sessions.length}, completed=${completedSessions.length}`);
        console.log(`Estimated kWh in window: ${totalEstimatedKwh}`);
        console.log(`Upsert result: inserted=${inserted}, updated=${updated}`);

        const table = new Table({
            head: ['#', 'Charge Started', 'Charge Ended', 'Duration (min)', 'kWh Estimated'],
            colWidths: [6, 28, 28, 16, 16]
        });

        completedSessions.forEach((session, index) => {
            table.push([
                index + 1,
                session.start.toISOString(),
                session.end.toISOString(),
                session.duration_minutes,
                session.kwh_estimated
            ]);
        });

        if (completedSessions.length > 0) {
            console.log(table.toString());
        }
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    storeOhmePowerEvents(7).catch((error) => {
        console.error('Failed to store Ohme power events:', error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    storeOhmePowerEvents
};
