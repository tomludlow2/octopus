const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { fetchProcessAndInsertOctopusData } = require('../lib/octopusDataProcessor');

function parseArgs(argv) {
    const args = {
        startMonth: null,
        maxMonths: null
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const value = argv[i + 1];

        if (token === '--start-month') args.startMonth = value;
        if (token === '--max-months') args.maxMonths = Number(value);
    }

    return args;
}

function validateArgs(args) {
    if (args.startMonth && Number.isNaN(new Date(`${args.startMonth}-01T00:00:00Z`).getTime())) {
        throw new Error('--start-month must be YYYY-MM');
    }

    if (args.maxMonths !== null && (!Number.isInteger(args.maxMonths) || args.maxMonths <= 0)) {
        throw new Error('--max-months must be a positive integer');
    }
}

function startOfMonthUTC(date) {
    const d = new Date(date);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

function addMonthsUTC(date, months) {
    const d = new Date(date);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d;
}

function formatMonth(date) {
    return date.toISOString().slice(0, 7);
}

function getMonthRanges(args) {
    const now = new Date();
    const currentMonthStart = startOfMonthUTC(now);

    const lowerBound = args.startMonth
        ? new Date(`${args.startMonth}-01T00:00:00Z`)
        : new Date('1970-01-01T00:00:00Z');

    const ranges = [];
    let cursor = currentMonthStart;

    while (cursor >= lowerBound) {
        const monthStart = new Date(cursor);
        const nextMonthStart = addMonthsUTC(monthStart, 1);
        const monthEnd = nextMonthStart > now ? now : nextMonthStart;

        ranges.push({
            month: formatMonth(monthStart),
            start: monthStart.toISOString(),
            end: monthEnd.toISOString()
        });

        if (args.maxMonths !== null && ranges.length >= args.maxMonths) {
            break;
        }

        cursor = addMonthsUTC(cursor, -1);
    }

    return ranges;
}

function askQuestion(rl, text) {
    return new Promise((resolve) => {
        rl.question(text, (answer) => resolve(answer.trim()));
    });
}

function buildMonthlySummaryRecord(range, results, action) {
    const importSummary = results?.data?.import_summary;
    const electric = importSummary?.electric?.consumption || null;
    const gas = importSummary?.gas?.consumption || null;

    return {
        month: range.month,
        start: range.start,
        end: range.end,
        action,
        electric: electric ? { inserted: electric.inserted, updated: electric.updated } : null,
        gas: gas ? { inserted: gas.inserted, updated: gas.updated } : null,
        failures: results.failures || []
    };
}

function writeMonthlyReport(records) {
    const outputDir = path.join(__dirname, '../reports');
    fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(outputDir, `monthly_import_${timestamp}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(records, null, 2), 'utf8');

    return outputPath;
}

async function runInteractiveMonthlyBackfill(args = parseArgs(process.argv)) {
    validateArgs(args);

    const ranges = getMonthRanges(args);
    const records = [];

    if (ranges.length === 0) {
        console.log('No months to process.');
        return { records, outputPath: null };
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        for (const range of ranges) {
            console.log(`\nMonth ${range.month} (${range.start} -> ${range.end})`);
            const answer = (await askQuestion(rl, 'Import this month? [Y]es / [N]o / [Q]uit: ')).toLowerCase();

            if (answer === 'q') {
                records.push({ month: range.month, start: range.start, end: range.end, action: 'quit' });
                break;
            }

            if (answer !== 'y') {
                records.push({ month: range.month, start: range.start, end: range.end, action: 'skipped' });
                console.log(`Skipped ${range.month}.`);
                continue;
            }

            const results = {
                success: [],
                failures: [],
                data: {},
                metadata: {
                    start_time: range.start,
                    end_time: range.end,
                    reason: 'interactive_monthly_backfill'
                }
            };

            try {
                await fetchProcessAndInsertOctopusData(range.start, range.end, results);
                const record = buildMonthlySummaryRecord(range, results, 'imported');
                records.push(record);

                console.log(
                    `Imported ${range.month} | electric new/update=${record.electric?.inserted ?? 0}/${record.electric?.updated ?? 0} `
                    + `| gas new/update=${record.gas?.inserted ?? 0}/${record.gas?.updated ?? 0}`
                );
            } catch (error) {
                records.push({
                    month: range.month,
                    start: range.start,
                    end: range.end,
                    action: 'failed',
                    error: error.message
                });

                console.error(`Failed ${range.month}: ${error.message}`);
            }
        }
    } finally {
        rl.close();
    }

    const outputPath = writeMonthlyReport(records);
    console.log(`\nMonthly import report written to ${outputPath}`);
    return { records, outputPath };
}

if (require.main === module) {
    runInteractiveMonthlyBackfill().catch((error) => {
        console.error('Failed to run interactive monthly backfill:', error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    runInteractiveMonthlyBackfill,
    parseArgs,
    getMonthRanges
};
