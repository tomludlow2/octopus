function parseArgs(argv) {
    const args = {
        start: null,
        end: null,
        source: 'both',
        limit: 10000,
        maxRanges: null,
        dryRun: false
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const value = argv[i + 1];

        if (token === '--start') args.start = value;
        if (token === '--end') args.end = value;
        if (token === '--source') args.source = value;
        if (token === '--limit') args.limit = Number(value);
        if (token === '--max-ranges') args.maxRanges = Number(value);
        if (token === '--dry-run') args.dryRun = true;
    }

    return args;
}

function validateArgs(args) {
    if (!args.start || !args.end) {
        throw new Error('Usage: node pg/import_missing_intervals.js --start <ISO> --end <ISO> [--source electric|gas|both] [--limit 10000] [--max-ranges 200] [--dry-run]');
    }

    if (Number.isNaN(new Date(args.start).getTime()) || Number.isNaN(new Date(args.end).getTime())) {
        throw new Error('--start and --end must be valid ISO timestamps');
    }

    if (!['electric', 'gas', 'both'].includes(args.source)) {
        throw new Error('--source must be one of electric, gas, both');
    }

    if (!Number.isInteger(args.limit) || args.limit <= 0) {
        throw new Error('--limit must be a positive integer');
    }

    if (args.maxRanges !== null && (!Number.isInteger(args.maxRanges) || args.maxRanges <= 0)) {
        throw new Error('--max-ranges must be a positive integer');
    }
}

function toImportRanges(result, source) {
    const ranges = [];

    if ((source === 'electric' || source === 'both') && result.electric) {
        ranges.push(...result.electric.missing_ranges);
    }

    if ((source === 'gas' || source === 'both') && result.gas) {
        ranges.push(...result.gas.missing_ranges);
    }

    const dedup = new Map();

    for (const range of ranges) {
        const key = `${range.missing_from}__${range.missing_to}`;
        if (!dedup.has(key)) {
            dedup.set(key, range);
        }
    }

    return [...dedup.values()].sort((a, b) => new Date(a.missing_from) - new Date(b.missing_from));
}

async function importMissingIntervals(args) {
    const { viewMissingIntervals } = require('./view_missing_intervals');
    const { fetchProcessAndInsertOctopusData } = require('../lib/octopusDataProcessor');
    const gapResult = await viewMissingIntervals(args.start, args.end, args.source, args.limit, { silent: true });

    let ranges = toImportRanges(gapResult, args.source);

    if (args.maxRanges !== null) {
        ranges = ranges.slice(0, args.maxRanges);
    }

    const summary = {
        period: { start: args.start, end: args.end },
        source: args.source,
        dry_run: args.dryRun,
        ranges_found: ranges.length,
        imported_ranges: 0,
        failures: []
    };

    if (ranges.length === 0) {
        return summary;
    }

    for (const range of ranges) {
        if (args.dryRun) {
            summary.imported_ranges += 1;
            continue;
        }

        const results = {
            success: [],
            failures: [],
            data: {},
            metadata: {
                start_time: range.missing_from,
                end_time: range.missing_to,
                reason: 'missing_interval_backfill'
            }
        };

        try {
            await fetchProcessAndInsertOctopusData(range.missing_from, range.missing_to, results);
            summary.imported_ranges += 1;
        } catch (error) {
            summary.failures.push({
                missing_from: range.missing_from,
                missing_to: range.missing_to,
                error: error.message
            });
        }
    }

    return summary;
}

async function run() {
    const args = parseArgs(process.argv);

    try {
        validateArgs(args);
        const summary = await importMissingIntervals(args);
        console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
        console.error('Failed to import missing intervals:', error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    run();
}

module.exports = { importMissingIntervals, toImportRanges };
