const { Client } = require('pg');
const Table = require('cli-table3');

const { loadDbConfig } = require('./loadDbConfig');

const dbConfig = loadDbConfig();

function parseArgs(argv) {
    const args = { windowMinutes: 30 };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];

        if (token === '--window-minutes' && next) {
            const parsed = Number(next);
            if (Number.isFinite(parsed) && parsed >= 0) {
                args.windowMinutes = Math.floor(parsed);
            }
        }
    }

    return args;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function analyzeAudiSocSamples(rows) {
    const samples = rows
        .map((row) => ({
            event_time: new Date(row.event_time),
            state: Number(row.new_state)
        }))
        .filter((row) => Number.isFinite(row.state) && !Number.isNaN(row.event_time.getTime()))
        .sort((a, b) => a.event_time - b.event_time);

    if (samples.length < 2) {
        return {
            sampleCount: samples.length,
            startSoc: samples[0]?.state ?? null,
            endSoc: samples[0]?.state ?? null,
            deltaSoc: 0,
            increaseSteps: 0,
            decreaseSteps: 0,
            increaseRatio: 0
        };
    }

    let increaseSteps = 0;
    let decreaseSteps = 0;

    for (let i = 1; i < samples.length; i += 1) {
        const delta = samples[i].state - samples[i - 1].state;
        if (delta > 0) increaseSteps += 1;
        if (delta < 0) decreaseSteps += 1;
    }

    const startSoc = samples[0].state;
    const endSoc = samples[samples.length - 1].state;
    const deltaSoc = endSoc - startSoc;
    const transitionCount = Math.max(1, samples.length - 1);
    const increaseRatio = increaseSteps / transitionCount;

    return {
        sampleCount: samples.length,
        startSoc,
        endSoc,
        deltaSoc,
        increaseSteps,
        decreaseSteps,
        increaseRatio
    };
}

function scoreAudiLikelihood(metrics) {
    const deltaComponent = clamp01(metrics.deltaSoc / 6); // +6% SOC in-window => max delta signal
    const trendComponent = clamp01(metrics.increaseRatio);
    const penaltyComponent = clamp01(metrics.decreaseSteps > 0 ? 0.2 : 0);

    const score = clamp01((deltaComponent * 0.65) + (trendComponent * 0.45) - penaltyComponent);
    return score;
}

async function run(options = {}) {
    const windowMinutes = options.windowMinutes ?? 30;

    const client = new Client(dbConfig);
    await client.connect();

    try {
        const groupsResult = await client.query(`
            SELECT id, group_started, group_ended, energy_kwh, vehicle
            FROM ohme_charge_event_groups
            ORDER BY group_started DESC
        `);

        if (groupsResult.rows.length === 0) {
            console.log('No grouped Ohme events found in ohme_charge_event_groups.');
            return;
        }

        const table = new Table({
            head: [
                'Group ID',
                'Start',
                'End',
                'kWh',
                'SOC Δ',
                'Samples',
                'Audi Likelihood',
                'BMW/Other Likelihood',
                'Audi:Other Ratio',
                'Current Vehicle',
                'Suggested'
            ],
            colWidths: [9, 18, 18, 8, 8, 8, 16, 18, 15, 14, 12]
        });

        for (const group of groupsResult.rows) {
            const start = new Date(group.group_started);
            const end = new Date(group.group_ended);

            const queryStart = new Date(start.getTime() - windowMinutes * 60 * 1000);
            const queryEnd = new Date(end.getTime() + windowMinutes * 60 * 1000);

            const socResult = await client.query(
                `SELECT event_time, new_state
                 FROM audi_events
                 WHERE entity_id = 'sensor.audi_q4_e_tron_state_of_charge'
                   AND new_state != 'unavailable'
                   AND event_time BETWEEN $1 AND $2
                 ORDER BY event_time ASC`,
                [queryStart.toISOString(), queryEnd.toISOString()]
            );

            const metrics = analyzeAudiSocSamples(socResult.rows);
            const audiLikelihood = scoreAudiLikelihood(metrics);
            const otherLikelihood = clamp01(1 - audiLikelihood);
            const ratio = otherLikelihood > 0
                ? Number((audiLikelihood / otherLikelihood).toFixed(3))
                : 'inf';

            const suggested = audiLikelihood >= 0.65
                ? 'Audi'
                : (audiLikelihood <= 0.35 ? 'BMW/Other' : 'uncertain');

            table.push([
                group.id,
                start.toISOString().slice(0, 16),
                end.toISOString().slice(0, 16),
                Number(group.energy_kwh || 0).toFixed(3),
                Number(metrics.deltaSoc || 0).toFixed(2),
                metrics.sampleCount,
                Number(audiLikelihood.toFixed(3)),
                Number(otherLikelihood.toFixed(3)),
                ratio,
                group.vehicle || 'unknown',
                suggested
            ]);
        }

        console.log(`Audi likelihood analysis completed for ${groupsResult.rows.length} grouped events (window=${windowMinutes}m).`);
        console.log(table.toString());
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    const args = parseArgs(process.argv);
    run(args).catch((error) => {
        console.error('Failed to identify Audi likelihood for Ohme grouped events:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { run, analyzeAudiSocSamples, scoreAudiLikelihood };
