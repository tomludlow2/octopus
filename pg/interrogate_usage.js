const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Table = require('cli-table3');
const { Client } = require('pg');

const { loadDbConfig } = require('../lib/loadDbConfig');
const { getTariffPeriodsForFuel, getElectricUnitRatesForPeriod, getGasUnitRatesForPeriod } = require('../lib/tariffRates');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
const dbConfig = loadDbConfig();

function parseArgs(argv) {
    const args = {
        start: null,
        end: null,
        source: 'both'
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const value = argv[i + 1];

        if (token === '--start') args.start = value;
        if (token === '--end') args.end = value;
        if (token === '--source') args.source = value;
    }

    return args;
}

function validateArgs(args) {
    if (!args.start || !args.end) {
        throw new Error('Usage: node pg/interrogate_usage.js --start <ISO> --end <ISO> [--source electric|gas|both]');
    }

    if (Number.isNaN(new Date(args.start).getTime()) || Number.isNaN(new Date(args.end).getTime())) {
        throw new Error('--start and --end must be valid ISO timestamps');
    }

    if (!['electric', 'gas', 'both'].includes(args.source)) {
        throw new Error('--source must be one of electric, gas, both');
    }
}

async function fetchAllPaginatedResults(initialUrl) {
    const allResults = [];
    let nextUrl = initialUrl;

    while (nextUrl) {
        const response = await axios.get(nextUrl, {
            auth: {
                username: config.api_key,
                password: ''
            }
        });

        const pageResults = response?.data?.results || [];
        allResults.push(...pageResults);
        nextUrl = response?.data?.next;
    }

    return allResults;
}

async function fetchApiUsage(fuel, startIso, endIso) {
    const isElectric = fuel === 'electric';
    const base = isElectric
        ? `https://api.octopus.energy/v1/electricity-meter-points/${config.e_mpan}/meters/${config.e_sn}/consumption/`
        : `https://api.octopus.energy/v1/gas-meter-points/${config.g_mprn}/meters/${config.g_sn}/consumption/`;

    const url = `${base}?period_from=${startIso}&period_to=${endIso}&order_by=period`;
    return fetchAllPaginatedResults(url);
}

async function fetchDbUsage(client, fuel, startIso, endIso) {
    const table = fuel === 'electric' ? 'electric_consumption' : 'gas_consumption';
    const result = await client.query(
        `SELECT start_time, end_time, consumption_kwh, price_pence
         FROM ${table}
         WHERE start_time >= $1 AND start_time < $2
         ORDER BY start_time`,
        [startIso, endIso]
    );

    return result.rows.map((row) => ({
        interval_start: new Date(row.start_time).toISOString(),
        interval_end: new Date(row.end_time).toISOString(),
        consumption_kwh: Number(row.consumption_kwh),
        price_pence: Number(row.price_pence)
    }));
}

function toMap(rows) {
    const map = new Map();
    for (const row of rows) {
        map.set(row.interval_start, row);
    }
    return map;
}

function findIntervalRate(intervalStartIso, rates, fuel) {
    const ts = new Date(intervalStartIso).getTime();
    const matching = rates.find((rate) => {
        const start = new Date(rate.valid_from).getTime();
        const end = rate.valid_to ? new Date(rate.valid_to).getTime() : Number.MAX_SAFE_INTEGER;
        return ts >= start && ts < end;
    });

    if (!matching) return null;

    return fuel === 'electric' ? Number(matching.value_exc_vat) : Number(matching.value_inc_vat);
}

function compareUsage(dbRows, apiRows, rates, fuel) {
    const dbMap = toMap(dbRows);
    const apiMap = toMap(apiRows.map((row) => ({
        interval_start: new Date(row.interval_start).toISOString(),
        interval_end: new Date(row.interval_end).toISOString(),
        consumption: Number(row.consumption)
    })));

    const allKeys = [...new Set([...dbMap.keys(), ...apiMap.keys()])].sort();
    const mismatches = [];

    for (const key of allKeys) {
        const db = dbMap.get(key) || null;
        const api = apiMap.get(key) || null;

        if (!db || !api) {
            mismatches.push({
                interval_start: key,
                issue: !db ? 'missing_in_db' : 'missing_in_api',
                db_consumption: db ? db.consumption_kwh : null,
                api_consumption: api ? api.consumption : null,
                db_price_pence: db ? db.price_pence : null,
                expected_price_pence: null
            });
            continue;
        }

        const rate = findIntervalRate(key, rates, fuel);
        const expectedPrice = rate === null ? null : Math.round((Math.round(api.consumption * 100) / 100) * rate * 100) / 100;
        const consumptionDiff = Math.abs(db.consumption_kwh - api.consumption);
        const priceDiff = expectedPrice === null ? 0 : Math.abs(db.price_pence - expectedPrice);

        if (consumptionDiff > 0.0001 || priceDiff > 0.01) {
            mismatches.push({
                interval_start: key,
                issue: 'value_mismatch',
                db_consumption: db.consumption_kwh,
                api_consumption: api.consumption,
                db_price_pence: db.price_pence,
                expected_price_pence: expectedPrice
            });
        }
    }

    return {
        total_db_rows: dbRows.length,
        total_api_rows: apiRows.length,
        mismatch_count: mismatches.length,
        mismatches
    };
}

function printTariffTable(fuel, tariffs) {
    const table = new Table({
        head: ['Fuel', 'Tariff', 'Product', 'Period From', 'Period To']
    });

    tariffs.forEach((item) => {
        const parts = String(item.tariff_code || '').split('-');
        const product = parts.length > 3 ? parts.slice(2, -1).join('-') : 'n/a';
        table.push([fuel, item.tariff_code, product, item.period_from, item.period_to]);
    });

    console.log(`\nTariffs for ${fuel.toUpperCase()}`);
    console.log(table.toString());
}

function printSummaryTable(fuel, comparison) {
    const table = new Table({
        head: ['Fuel', 'DB rows', 'API rows', 'Mismatches']
    });
    table.push([fuel, comparison.total_db_rows, comparison.total_api_rows, comparison.mismatch_count]);

    console.log(`\nUsage comparison summary for ${fuel.toUpperCase()}`);
    console.log(table.toString());
}

function printMismatchTable(fuel, mismatches) {
    const table = new Table({
        head: ['Interval Start', 'Issue', 'DB kWh', 'API kWh', 'DB pence', 'Expected pence']
    });

    mismatches.slice(0, 60).forEach((item) => {
        table.push([
            item.interval_start,
            item.issue,
            item.db_consumption ?? '-',
            item.api_consumption ?? '-',
            item.db_price_pence ?? '-',
            item.expected_price_pence ?? '-'
        ]);
    });

    console.log(`\nMismatches for ${fuel.toUpperCase()} (showing up to 60)`);
    console.log(table.toString());
}

function buildOutputPath() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');

    const file = `interrogation_${dd}_${mm}_${yy}_${hh}_${min}.json`;
    return path.join(__dirname, '../reports', file);
}

async function interrogate(args = parseArgs(process.argv)) {
    validateArgs(args);

    const client = new Client(dbConfig);

    try {
        await client.connect();

        const fuels = args.source === 'both' ? ['electric', 'gas'] : [args.source];
        const report = {
            requested_period: { start: args.start, end: args.end },
            source: args.source,
            generated_at: new Date().toISOString(),
            results: {}
        };

        for (const fuel of fuels) {
            const [dbRows, apiRows, rates, tariffs] = await Promise.all([
                fetchDbUsage(client, fuel, args.start, args.end),
                fetchApiUsage(fuel, args.start, args.end),
                fuel === 'electric'
                    ? getElectricUnitRatesForPeriod(args.start, args.end)
                    : getGasUnitRatesForPeriod(args.start, args.end),
                getTariffPeriodsForFuel(fuel, args.start, args.end)
            ]);

            const comparison = compareUsage(dbRows, apiRows, rates, fuel);

            printTariffTable(fuel, tariffs);
            printSummaryTable(fuel, comparison);
            if (comparison.mismatch_count > 0) {
                printMismatchTable(fuel, comparison.mismatches);
            }

            report.results[fuel] = {
                tariffs,
                db_rows: dbRows,
                api_rows: apiRows,
                rates,
                comparison
            };
        }

        const outputPath = buildOutputPath();
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

        console.log(`\nInterrogation report written to ${outputPath}`);
        return report;
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    interrogate().catch((error) => {
        console.error('Failed interrogation:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { interrogate, parseArgs, compareUsage };
