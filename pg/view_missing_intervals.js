const { Client } = require('pg');
const { loadDbConfig } = require('../lib/loadDbConfig');

const dbConfig = loadDbConfig();

function parseArgs(argv) {
    const args = {
        start: null,
        end: null,
        source: 'both',
        limit: 200
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const value = argv[i + 1];

        if (token === '--start') args.start = value;
        if (token === '--end') args.end = value;
        if (token === '--source') args.source = value;
        if (token === '--limit') args.limit = Number(value);
    }

    return args;
}

function validateArgs(args) {
    if (!args.start || !args.end) {
        throw new Error('Usage: node pg/view_missing_intervals.js --start 2024-01-01T00:00:00Z --end 2024-01-07T00:00:00Z [--source electric|gas|both] [--limit 200]');
    }

    if (!['electric', 'gas', 'both'].includes(args.source)) {
        throw new Error('--source must be one of: electric, gas, both');
    }

    if (!Number.isInteger(args.limit) || args.limit <= 0) {
        throw new Error('--limit must be a positive integer');
    }
}

async function getMissingIntervals(client, tableName, start, end, limit) {
    const query = `
        WITH expected AS (
            SELECT generate_series($1::timestamptz, $2::timestamptz - interval '30 minute', interval '30 minute') AS interval_start
        )
        SELECT expected.interval_start
        FROM expected
        LEFT JOIN ${tableName} data ON data.start_time = expected.interval_start
        WHERE data.start_time IS NULL
        ORDER BY expected.interval_start
        LIMIT $3;
    `;

    const result = await client.query(query, [start, end, limit]);
    return result.rows.map((row) => row.interval_start);
}

function groupContiguousIntervals(intervals) {
    if (!intervals.length) return [];

    const sorted = intervals.map((d) => new Date(d)).sort((a, b) => a - b);
    const groups = [];

    let rangeStart = sorted[0];
    let previous = sorted[0];

    for (let i = 1; i < sorted.length; i += 1) {
        const current = sorted[i];
        const minutes = (current - previous) / 60000;

        if (minutes === 30) {
            previous = current;
            continue;
        }

        groups.push({
            missing_from: rangeStart.toISOString(),
            missing_to: new Date(previous.getTime() + (30 * 60 * 1000)).toISOString(),
            missing_intervals: Math.round((previous - rangeStart) / (30 * 60 * 1000)) + 1
        });

        rangeStart = current;
        previous = current;
    }

    groups.push({
        missing_from: rangeStart.toISOString(),
        missing_to: new Date(previous.getTime() + (30 * 60 * 1000)).toISOString(),
        missing_intervals: Math.round((previous - rangeStart) / (30 * 60 * 1000)) + 1
    });

    return groups;
}

async function viewMissingIntervals(start, end, source = 'both', limit = 200) {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        const response = {};

        if (source === 'electric' || source === 'both') {
            const missingElectric = await getMissingIntervals(client, 'electric_consumption', start, end, limit);
            response.electric = {
                missing_intervals: missingElectric.length,
                missing_ranges: groupContiguousIntervals(missingElectric)
            };
        }

        if (source === 'gas' || source === 'both') {
            const missingGas = await getMissingIntervals(client, 'gas_consumption', start, end, limit);
            response.gas = {
                missing_intervals: missingGas.length,
                missing_ranges: groupContiguousIntervals(missingGas)
            };
        }

        console.log(JSON.stringify({
            requested_period: { start, end },
            source,
            limit,
            result: response
        }, null, 2));

        return response;
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    const args = parseArgs(process.argv);

    try {
        validateArgs(args);
        viewMissingIntervals(args.start, args.end, args.source, args.limit).catch((error) => {
            console.error('Failed to inspect missing intervals:', error.message);
            process.exitCode = 1;
        });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    viewMissingIntervals,
    groupContiguousIntervals
};
