const { repriceElectricConsumption } = require('../lib/repriceElectricConsumption');

function parseArgs(argv) {
    const args = {
        start: null,
        end: null,
        dryRun: false
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const value = argv[i + 1];

        if (token === '--start') args.start = value;
        if (token === '--end') args.end = value;
        if (token === '--dry-run') args.dryRun = true;
    }

    return args;
}

function validateArgs(args) {
    if (!args.start || !args.end) {
        throw new Error('Usage: node pg/reprice_historical_electric.js --start <ISO> --end <ISO> [--dry-run]');
    }

    if (Number.isNaN(new Date(args.start).getTime()) || Number.isNaN(new Date(args.end).getTime())) {
        throw new Error('--start and --end must be valid ISO timestamps');
    }
}

async function run() {
    const args = parseArgs(process.argv);

    try {
        validateArgs(args);

        const summary = await repriceElectricConsumption(args.start, args.end, {
            dryRun: args.dryRun
        });

        console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
        console.error('Failed to reprice historical electric usage:', error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    run();
}
