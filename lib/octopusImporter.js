const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const { loadDbConfig } = require('./loadDbConfig');
const { appendActivityLog } = require('./activityLogger');
const { getElectricUnitRatesForPeriod, getGasUnitRatesForPeriod, getTariffPeriodsForFuel } = require('./tariffRates');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
const tariff = JSON.parse(fs.readFileSync(path.join(__dirname, '../tariff.json'), 'utf8'));
const dbConfig = loadDbConfig();

function isoDate(value) {
    return new Date(value).toISOString();
}

function roundToNearest(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}

function normalizeRange(startDate, endDate) {
    const start = startDate.includes('T') ? startDate : `${startDate}T00:00:00Z`;
    const end = endDate.includes('T') ? endDate : `${endDate}T00:00:00Z`;
    return { start, end };
}

async function fetchAllPaginatedResults(initialUrl) {
    const allResults = [];
    let nextUrl = initialUrl;

    while (nextUrl) {
        const response = await axios.get(nextUrl, {
            auth: { username: config.api_key, password: '' }
        });

        const pageResults = response?.data?.results || [];
        allResults.push(...pageResults);
        nextUrl = response?.data?.next;
    }

    return allResults;
}

async function fetchUsageIntervals(fuel, startIso, endIso) {
    const isElectric = fuel === 'electric';
    const base = isElectric
        ? `https://api.octopus.energy/v1/electricity-meter-points/${config.e_mpan}/meters/${config.e_sn}/consumption/`
        : `https://api.octopus.energy/v1/gas-meter-points/${config.g_mprn}/meters/${config.g_sn}/consumption/`;

    const url = `${base}?period_from=${startIso}&period_to=${endIso}&order_by=period`;
    return fetchAllPaginatedResults(url);
}

function toHalfHourIntervals(rates) {
    const expanded = [];

    for (const rate of rates) {
        const start = new Date(rate.valid_from).getTime();
        const end = new Date(rate.valid_to).getTime();

        for (let cursor = start; cursor < end; cursor += 30 * 60 * 1000) {
            expanded.push({
                interval_start: new Date(cursor).toISOString(),
                value_inc_vat: Number(rate.value_inc_vat),
                value_exc_vat: Number(rate.value_exc_vat),
                tariff_code: rate.tariff_code || null
            });
        }
    }

    return expanded;
}

function buildRateMap(rates) {
    const expanded = toHalfHourIntervals(rates);
    const map = new Map();

    for (const row of expanded) {
        map.set(row.interval_start, row);
    }

    return map;
}

async function getMissingRanges(client, tableName, startIso, endIso) {
    const query = `
        WITH expected AS (
            SELECT generate_series($1::timestamptz, $2::timestamptz - interval '30 minute', interval '30 minute') AS interval_start
        )
        SELECT expected.interval_start
        FROM expected
        LEFT JOIN ${tableName} data ON data.start_time = expected.interval_start
        WHERE data.start_time IS NULL
        ORDER BY expected.interval_start;
    `;

    const result = await client.query(query, [startIso, endIso]);
    const intervals = result.rows.map((row) => row.interval_start);

    if (intervals.length === 0) return [];

    const ranges = [];
    let rangeStart = intervals[0];
    let previous = intervals[0];

    for (let i = 1; i < intervals.length; i += 1) {
        const current = intervals[i];
        const diff = (new Date(current) - new Date(previous)) / 60000;

        if (diff === 30) {
            previous = current;
            continue;
        }

        ranges.push({
            start: isoDate(rangeStart),
            end: new Date(new Date(previous).getTime() + (30 * 60 * 1000)).toISOString(),
            missing_intervals: Math.round((new Date(previous) - new Date(rangeStart)) / (30 * 60 * 1000)) + 1
        });

        rangeStart = current;
        previous = current;
    }

    ranges.push({
        start: isoDate(rangeStart),
        end: new Date(new Date(previous).getTime() + (30 * 60 * 1000)).toISOString(),
        missing_intervals: Math.round((new Date(previous) - new Date(rangeStart)) / (30 * 60 * 1000)) + 1
    });

    return ranges;
}

function dedupeUsageRows(rows) {
    const map = new Map();

    for (const row of rows) {
        map.set(isoDate(row.interval_start), row);
    }

    return [...map.values()].sort((a, b) => new Date(a.interval_start) - new Date(b.interval_start));
}

function mergeRanges(missingRanges, backfillStart, endIso) {
    const ranges = [...missingRanges.map((item) => ({ ...item, reason: 'missing' }))];

    if (new Date(backfillStart) < new Date(endIso)) {
        ranges.push({ start: backfillStart, end: endIso, missing_intervals: 0, reason: 'backfill' });
    }

    return ranges;
}

async function fetchRatesForFuel(fuel, startIso, endIso) {
    return fuel === 'electric'
        ? getElectricUnitRatesForPeriod(startIso, endIso)
        : getGasUnitRatesForPeriod(startIso, endIso);
}

async function upsertUsageRows(client, fuel, usageRows, rateMap) {
    const table = fuel === 'electric' ? 'electric_consumption' : 'gas_consumption';
    const conversion = fuel === 'gas' ? Number(tariff.gas_conversion || 1) : 1;

    let inserted = 0;
    let updated = 0;

    for (const usage of usageRows) {
        const startIso = isoDate(usage.interval_start);
        const rate = rateMap.get(startIso);
        const converted = Number(usage.consumption) * conversion;
        const consumption = roundToNearest(converted, 3);
        const endIso = isoDate(usage.interval_end);

        const price = rate
            ? roundToNearest(roundToNearest(consumption, 2) * Number(rate.value_inc_vat), 2)
            : 0;

        const result = await client.query(
            `INSERT INTO ${table} (consumption_kwh, price_pence, start_time, end_time)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (start_time)
             DO UPDATE SET
               consumption_kwh = EXCLUDED.consumption_kwh,
               price_pence = EXCLUDED.price_pence,
               end_time = EXCLUDED.end_time
             RETURNING (xmax = 0) AS inserted`,
            [consumption, price, startIso, endIso]
        );

        if (result.rows[0].inserted) inserted += 1;
        else updated += 1;
    }

    return { inserted, updated };
}

async function importFuelRange(client, fuel, startIso, endIso, options = {}) {
    const backfillDays = Number(process.env.OCTOPUS_BACKFILL_DAYS || 14);
    const now = new Date();
    const backfillFloor = new Date(now.getTime() - backfillDays * 24 * 60 * 60 * 1000).toISOString();
    const backfillStart = backfillFloor < startIso ? backfillFloor : startIso;
    const tableName = fuel === 'electric' ? 'electric_consumption' : 'gas_consumption';

    const missingRanges = await getMissingRanges(client, tableName, startIso, endIso);
    const queryRanges = mergeRanges(missingRanges, backfillStart, endIso);

    const usageChunks = [];
    for (const range of queryRanges) {
        const chunk = await fetchUsageIntervals(fuel, range.start, range.end);
        usageChunks.push(...chunk);
    }

    const usageRows = dedupeUsageRows(usageChunks);
    const rates = await fetchRatesForFuel(fuel, backfillStart, endIso);
    const rateMap = buildRateMap(rates);
    const tariffs = await getTariffPeriodsForFuel(fuel, startIso, endIso);

    const reasonParts = [];
    if (missingRanges.length) {
        reasonParts.push(`missing_ranges=${missingRanges.length}`);
    }
    reasonParts.push(`backfill=${backfillDays}d`);
    if (options.reason) {
        reasonParts.push(options.reason);
    }
    const reasonText = reasonParts.join('; ');

    await client.query('BEGIN');
    try {
        const consumptionSummary = await upsertUsageRows(client, fuel, usageRows, rateMap);
        await client.query('COMMIT');

        appendActivityLog(
            `Imported ${fuel.toUpperCase()} ${startIso}..${endIso} because ${reasonText}; tariffs=${tariffs.map((t) => t.tariff_code).join(',') || 'none'}; `
            + `usage fetched=${usageRows.length}; upserted new=${consumptionSummary.inserted} updated=${consumptionSummary.updated}`
        );

        return {
            fuel,
            startIso,
            endIso,
            reason: reasonText,
            missing_ranges: missingRanges.length,
            usage_fetched: usageRows.length,
            consumption: consumptionSummary
        };
    } catch (error) {
        await client.query('ROLLBACK');
        appendActivityLog(`Failed ${fuel.toUpperCase()} import ${startIso}..${endIso}; reason=${reasonText}; error=${error.message}`);
        throw error;
    }
}

async function importOctopusData(startDate, endDate, options = {}) {
    const { start, end } = normalizeRange(startDate, endDate);
    const client = new Client(dbConfig);

    try {
        await client.connect();

        const electric = await importFuelRange(client, 'electric', start, end, options);
        const gas = await importFuelRange(client, 'gas', start, end, options);

        return { period: { start, end }, electric, gas };
    } finally {
        await client.end();
    }
}

module.exports = {
    importOctopusData,
    importFuelRange,
    buildRateMap,
    upsertUsageRows,
    dedupeUsageRows
};
