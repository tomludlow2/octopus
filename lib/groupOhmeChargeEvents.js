const { Client } = require('pg');
const { loadDbConfig } = require('./loadDbConfig');

const dbConfig = loadDbConfig();

const GROUPING_VERSION = 'v1_gap15';
const DEFAULT_MERGE_GAP_MINUTES = 15;

function parseArgs(argv) {
    const args = {
        mergeGapMinutes: DEFAULT_MERGE_GAP_MINUTES,
        groupingVersion: GROUPING_VERSION
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];

        if (token === '--merge-gap-minutes' && next) {
            const parsed = Number(next);
            if (Number.isFinite(parsed) && parsed >= 0) {
                args.mergeGapMinutes = Math.floor(parsed);
            }
        }

        if (token === '--grouping-version' && next) {
            args.groupingVersion = String(next);
        }
    }

    return args;
}

async function ensureTables(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS ohme_charge_event_groups (
            id BIGSERIAL PRIMARY KEY,
            group_started TIMESTAMPTZ NOT NULL,
            group_ended TIMESTAMPTZ NOT NULL,
            duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
            energy_kwh NUMERIC(12, 6) NOT NULL DEFAULT 0,
            cross_checked BOOLEAN NOT NULL DEFAULT FALSE,
            vehicle TEXT NOT NULL DEFAULT 'unknown' CHECK (vehicle IN ('Audi', 'BMW', 'unknown')),
            grouping_version TEXT NOT NULL DEFAULT 'v1_gap15',
            merge_gap_minutes INTEGER NOT NULL DEFAULT 15,
            pricing_source TEXT,
            estimated_cost_gbp NUMERIC(12, 6),
            assumed_rate_p_per_kwh NUMERIC(12, 6) NOT NULL DEFAULT 7.0,
            assumed_cost_gbp NUMERIC(12, 6),
            billed_cost_gbp NUMERIC(12, 6),
            billed_checked_at TIMESTAMPTZ,
            billing_notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (group_started, group_ended, grouping_version)
        );

        CREATE TABLE IF NOT EXISTS ohme_charge_event_group_members (
            id BIGSERIAL PRIMARY KEY,
            group_id BIGINT NOT NULL REFERENCES ohme_charge_event_groups(id) ON DELETE CASCADE,
            raw_event_id BIGINT NOT NULL REFERENCES ohme_charge_events(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (group_id, raw_event_id),
            UNIQUE (raw_event_id)
        );
    `);
}

function groupRows(rows, mergeGapMinutes) {
    if (!rows.length) return [];

    const grouped = [];
    let current = null;

    for (const row of rows) {
        const start = new Date(row.charge_started);
        const end = new Date(row.charge_ended);
        const durationMinutes = Math.max(0, Math.round((end - start) / 60000));
        const energyKwh = Number(row.kwh_estimated || 0);

        if (!current) {
            current = {
                started: start,
                ended: end,
                duration_minutes: durationMinutes,
                energy_kwh: energyKwh,
                raw_event_ids: [row.id]
            };
            continue;
        }

        const gapMinutes = (start.getTime() - current.ended.getTime()) / 60000;

        if (gapMinutes <= mergeGapMinutes && gapMinutes >= -1) {
            current.ended = end > current.ended ? end : current.ended;
            current.duration_minutes = Math.max(0, Math.round((current.ended - current.started) / 60000));
            current.energy_kwh += energyKwh;
            current.raw_event_ids.push(row.id);
        } else {
            grouped.push(current);
            current = {
                started: start,
                ended: end,
                duration_minutes: durationMinutes,
                energy_kwh: energyKwh,
                raw_event_ids: [row.id]
            };
        }
    }

    if (current) grouped.push(current);

    return grouped.map((g) => ({
        ...g,
        energy_kwh: Number(g.energy_kwh.toFixed(6))
    }));
}

async function runGrouping(options = {}) {
    const mergeGapMinutes = options.mergeGapMinutes ?? DEFAULT_MERGE_GAP_MINUTES;
    const groupingVersion = options.groupingVersion ?? GROUPING_VERSION;

    const client = new Client(dbConfig);
    await client.connect();

    try {
        await ensureTables(client);

        const rawResult = await client.query(`
            SELECT id, charge_started, charge_ended, kwh_estimated
            FROM ohme_charge_events
            WHERE charge_ended IS NOT NULL
            ORDER BY charge_started ASC
        `);

        const grouped = groupRows(rawResult.rows, mergeGapMinutes);

        await client.query('BEGIN');
        await client.query('DELETE FROM ohme_charge_event_group_members USING ohme_charge_event_groups g WHERE ohme_charge_event_group_members.group_id = g.id AND g.grouping_version = $1', [groupingVersion]);
        await client.query('DELETE FROM ohme_charge_event_groups WHERE grouping_version = $1', [groupingVersion]);

        let insertedGroups = 0;
        let insertedMembers = 0;

        for (const g of grouped) {
            const groupInsert = await client.query(
                `INSERT INTO ohme_charge_event_groups (
                    group_started, group_ended, duration_minutes, energy_kwh,
                    grouping_version, merge_gap_minutes, cross_checked, vehicle,
                    assumed_rate_p_per_kwh, assumed_cost_gbp, pricing_source, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,FALSE,'unknown',7.0,$7,'assumed_flat_7p',NOW())
                RETURNING id`,
                [
                    g.started.toISOString(),
                    g.ended.toISOString(),
                    g.duration_minutes,
                    g.energy_kwh,
                    groupingVersion,
                    mergeGapMinutes,
                    Number((g.energy_kwh * 0.07).toFixed(6))
                ]
            );

            const groupId = groupInsert.rows[0].id;
            insertedGroups += 1;

            for (const rawId of g.raw_event_ids) {
                await client.query(
                    `INSERT INTO ohme_charge_event_group_members (group_id, raw_event_id)
                     VALUES ($1, $2)
                     ON CONFLICT (raw_event_id) DO UPDATE SET group_id = EXCLUDED.group_id`,
                    [groupId, rawId]
                );
                insertedMembers += 1;
            }
        }

        await client.query('COMMIT');

        console.log(`Grouping complete. raw_rows=${rawResult.rows.length} groups=${insertedGroups} members=${insertedMembers} merge_gap_minutes=${mergeGapMinutes} version=${groupingVersion}`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    const args = parseArgs(process.argv);
    runGrouping(args).catch((error) => {
        console.error('Failed to group Ohme charge events:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { runGrouping, groupRows };
