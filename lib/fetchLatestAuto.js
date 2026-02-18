const { Client } = require('pg');
const { loadDbConfig } = require('./loadDbConfig');
const { fetchProcessAndInsertOctopusData } = require('./octopusDataProcessor');
const { sendLast3DaysUsageNotification } = require('./usageNotificationService');
const { localErrorNotify } = require('./localNotifier');

const dbConfig = loadDbConfig();

async function getLastCommonImportStart(client) {
    const result = await client.query(`
        SELECT
          (SELECT MAX(start_time) FROM electric_consumption) AS electric_max,
          (SELECT MAX(start_time) FROM gas_consumption) AS gas_max
    `);

    const row = result.rows[0] || {};

    if (!row.electric_max && !row.gas_max) {
        return null;
    }

    if (!row.electric_max) return new Date(row.gas_max);
    if (!row.gas_max) return new Date(row.electric_max);

    return new Date(Math.min(new Date(row.electric_max).getTime(), new Date(row.gas_max).getTime()));
}

async function runFetchAutoLatest() {
    const client = new Client(dbConfig);

    let start;
    const end = new Date();

    try {
        await client.connect();
        const lastCommon = await getLastCommonImportStart(client);

        if (!lastCommon) {
            start = new Date(end.getTime() - (3 * 24 * 60 * 60 * 1000));
        } else {
            start = new Date(lastCommon.getTime() - (24 * 60 * 60 * 1000));
        }
    } finally {
        await client.end();
    }

    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const results = {
        success: [],
        failures: [],
        data: {},
        metadata: {
            start_time: startIso,
            end_time: endIso,
            reason: 'auto_latest_with_24h_overlap'
        }
    };

    try {
        await fetchProcessAndInsertOctopusData(startIso, endIso, results);
        await sendLast3DaysUsageNotification();
        console.log(JSON.stringify({
            outcome: 'ok',
            import_period: { start: startIso, end: endIso },
            details: results
        }, null, 2));
    } catch (error) {
        await localErrorNotify(
            'AUTO_FETCH_IMPORT_ERROR',
            error.message || 'Unknown error during automatic import',
            { url: 'http://localhost:52529/logs' }
        ).catch(() => {
            // swallow notifier errors after primary failure
        });

        console.error('Auto fetch latest failed:', error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    runFetchAutoLatest();
}

module.exports = { runFetchAutoLatest, getLastCommonImportStart };
