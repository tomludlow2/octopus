const { repriceElectricConsumption } = require('../lib/repriceElectricConsumption');
const { repriceGasConsumption } = require('../lib/repriceGasConsumption');

function parseArgs(argv) {
    const args = {
        start: null,
        end: null,
        dryRun: false,
        source: 'both'
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const value = argv[i + 1];

        if (token === '--start') args.start = value;
        if (token === '--end') args.end = value;
        if (token === '--dry-run') args.dryRun = true;
        if (token === '--source') args.source = value;
    }

    return args;
}

function validateArgs(args) {
    if (!args.start || !args.end) {
        throw new Error('Usage: node pg/reprice_historical_usage.js --start <ISO> --end <ISO> [--source electric|gas|both] [--dry-run]');
    }

    if (Number.isNaN(new Date(args.start).getTime()) || Number.isNaN(new Date(args.end).getTime())) {
        throw new Error('--start and --end must be valid ISO timestamps');
    }

    if (!['electric', 'gas', 'both'].includes(args.source)) {
        throw new Error('--source must be one of electric, gas, both');
    }
}

async function run() {
    const args = parseArgs(process.argv);

    try {
        validateArgs(args);

        const summary = {
            period: { start: args.start, end: args.end },
            source: args.source,
            dry_run: args.dryRun,
            electric: null,
            gas: null
        };

        if (args.source === 'electric' || args.source === 'both') {
            summary.electric = await repriceElectricConsumption(args.start, args.end, { dryRun: args.dryRun });
        }

        if (args.source === 'gas' || args.source === 'both') {
            summary.gas = await repriceGasConsumption(args.start, args.end, { dryRun: args.dryRun });
        }

        console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
        console.error('Failed to reprice historical usage:', error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    run();
}
