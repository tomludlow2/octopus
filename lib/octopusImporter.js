const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const { loadDbConfig } = require('./loadDbConfig');
const { runMigrations } = require('./dbMigrations');
const { appendActivityLog } = require('./activityLogger');
const { getElectricUnitRatesForPeriod, getGasUnitRatesForPeriod, getTariffPeriodsForFuel } = require('./tariffRates');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
const tariff = JSON.parse(fs.readFileSync(path.join(__dirname, '../tariff.json'), 'utf8'));
const dbConfig = loadDbConfig();

function isoDate(value) {
    return new Date(value).toISOString();
}

function toHalfHourIntervals(rate) {
    const start = new Date(rate.valid_from).getTime();
    const end = new Date(rate.valid_to).getTime();
    const intervals = [];

    for (let cursor = start; cursor < end; cursor += 30 * 60 * 1000) {
        intervals.push({
            interval_start: new Date(cursor).toISOString(),
            interval_end: new Date(cursor + 30 * 60 * 1000).toISOString(),
            tariff_code: rate.tariff_code || null,
            value_inc_vat: rate.value_inc_vat,
            value_exc_vat: rate.value_exc_vat,
            payment_method: rate.payment_method || null,
            source_updated_at: rate.valid_from,
            source_hash: [rate.valid_from, rate.valid_to, rate.value_inc_vat, rate.value_exc_vat, rate.payment_method || ''].join('|')
        });
    }

    return intervals;
}

function roundToNearest(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
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

    if (intervals.length === 0) {
        return [];
    }

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
            end: new Date(new Date(previous).getTime() + 30 * 60 * 1000).toISOString(),
            missing_intervals: Math.round((new Date(previous) - new Date(rangeStart)) / (30 * 60 * 1000)) + 1
        });

        rangeStart = current;
        previous = current;
    }

    ranges.push({
        start: isoDate(rangeStart),
        end: new Date(new Date(previous).getTime() + 30 * 60 * 1000).toISOString(),
        missing_intervals: Math.round((new Date(previous) - new Date(rangeStart)) / (30 * 60 * 1000)) + 1
    });

    return ranges;
}

function normalizeRange(startDate, endDate) {
    const start = startDate.includes('T') ? startDate : `${startDate}T00:00:00Z`;
    const end = endDate.includes('T') ? endDate : `${endDate}T00:00:00Z`;
    return { start, end };
}

async function fetchRatesForFuel(fuel, startIso, endIso) {
    return fuel === 'electric'
        ? getElectricUnitRatesForPeriod(startIso, endIso)
        : getGasUnitRatesForPeriod(startIso, endIso);
}

function ratesToIntervalRows(fuel, rates) {
    return rates.flatMap((rate) => toHalfHourIntervals(rate).map((row) => ({ ...row, fuel })));
}

async function upsertRateIntervals(client, fuel, rateRows, reason) {
    if (rateRows.length === 0) {
        return { inserted: 0, updated: 0, changed: 0 };
    }

    const keys = rateRows.map((row) => [fuel, row.tariff_code, row.interval_start]);
    const existing = await client.query(
        `SELECT fuel, tariff_code, interval_start, value_inc_vat, value_exc_vat, source_hash, source_updated_at
         FROM octopus_rate_intervals
         WHERE (fuel, tariff_code, interval_start) IN (${keys.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(',')})`,
        keys.flat()
    );

    const existingMap = new Map(existing.rows.map((row) => [`${row.fuel}|${row.tariff_code}|${isoDate(row.interval_start)}`, row]));
    let changed = 0;

    for (const row of rateRows) {
        const key = `${fuel}|${row.tariff_code}|${isoDate(row.interval_start)}`;
        const prev = existingMap.get(key);

        if (prev && (String(prev.value_inc_vat) !== String(row.value_inc_vat)
            || String(prev.value_exc_vat) !== String(row.value_exc_vat)
            || String(prev.source_hash || '') !== String(row.source_hash || ''))) {
            changed += 1;
            await client.query(
                `INSERT INTO octopus_rate_change_audit
                 (fuel, tariff_code, interval_start, previous_value_inc_vat, new_value_inc_vat, previous_value_exc_vat, new_value_exc_vat, previous_source_updated_at, new_source_updated_at, reason)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [fuel, row.tariff_code, row.interval_start, prev.value_inc_vat, row.value_inc_vat, prev.value_exc_vat, row.value_exc_vat, prev.source_updated_at, row.source_updated_at, reason]
            );
        }
    }

    let inserted = 0;
    let updated = 0;

    for (const row of rateRows) {
        const result = await client.query(
            `INSERT INTO octopus_rate_intervals
             (fuel, tariff_code, interval_start, interval_end, value_inc_vat, value_exc_vat, payment_method, source_updated_at, source_hash, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
             ON CONFLICT (fuel, tariff_code, interval_start)
             DO UPDATE SET
                interval_end = EXCLUDED.interval_end,
                value_inc_vat = EXCLUDED.value_inc_vat,
                value_exc_vat = EXCLUDED.value_exc_vat,
                payment_method = EXCLUDED.payment_method,
                source_updated_at = EXCLUDED.source_updated_at,
                source_hash = EXCLUDED.source_hash,
                updated_at = NOW()
             RETURNING (xmax = 0) AS inserted;`,
            [fuel, row.tariff_code, row.interval_start, row.interval_end, row.value_inc_vat, row.value_exc_vat, row.payment_method, row.source_updated_at, row.source_hash]
        );

        if (result.rows[0].inserted) inserted += 1;
        else updated += 1;
    }

    return { inserted, updated, changed };
}

function buildRateMap(rateRows) {
    const map = new Map();
    for (const row of rateRows) {
        map.set(isoDate(row.interval_start), row);
    }
    return map;
}

async function upsertConsumption(client, fuel, usageRows, rateRows) {
    const table = fuel === 'electric' ? 'electric_consumption' : 'gas_consumption';
    const rateMap = buildRateMap(rateRows);
    const conversion = fuel === 'gas' ? Number(tariff.gas_conversion || 1) : 1;

    let inserted = 0;
    let updated = 0;

    for (const usage of usageRows) {
        const key = isoDate(usage.interval_start);
        const rate = rateMap.get(key);
        const rawConsumption = Number(usage.consumption) * conversion;
        const consumption = roundToNearest(rawConsumption, 3);

        const price = rate
            ? roundToNearest(roundToNearest(consumption, 2) * Number(fuel === 'electric' ? rate.value_exc_vat : rate.value_inc_vat), 2)
            : 0;

        const result = await client.query(
            `INSERT INTO ${table} (consumption_kwh, price_pence, start_time, end_time)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (start_time)
             DO UPDATE SET consumption_kwh = EXCLUDED.consumption_kwh, price_pence = EXCLUDED.price_pence, end_time = EXCLUDED.end_time
             RETURNING (xmax = 0) AS inserted;`,
            [consumption, price, usage.interval_start, usage.interval_end]
        );

        if (result.rows[0].inserted) inserted += 1;
        else updated += 1;
    }

    return { inserted, updated };
}

async function importFuelRange(client, fuel, startIso, endIso, options = {}) {
    const backfillDays = Number(process.env.OCTOPUS_BACKFILL_DAYS || 14);
    const now = new Date();
    const backfillStart = new Date(now.getTime() - backfillDays * 24 * 60 * 60 * 1000).toISOString();
    const tableName = fuel === 'electric' ? 'electric_consumption' : 'gas_consumption';

    const missingRanges = await getMissingRanges(client, tableName, startIso, endIso);
    const tariffs = await getTariffPeriodsForFuel(fuel, startIso, endIso);

    const consumptionRows = [];
    for (const range of missingRanges) {
        const chunk = await fetchUsageIntervals(fuel, range.start, range.end);
        consumptionRows.push(...chunk);
    }

    const ratesStart = backfillStart < startIso ? backfillStart : startIso;
    const rates = await fetchRatesForFuel(fuel, ratesStart, endIso);
    const intervalRates = ratesToIntervalRows(fuel, rates);

    const reasons = [];
    if (missingRanges.length > 0) reasons.push(`DB missing ${missingRanges.reduce((sum, r) => sum + r.missing_intervals, 0)} intervals`);
    if (backfillDays > 0) reasons.push(`backfill=${backfillDays}d`);
    if (options.reason) reasons.push(options.reason);
    const reasonText = reasons.join('; ') || 'manual run';

    await client.query('BEGIN');
    try {
        const rateSummary = await upsertRateIntervals(client, fuel, intervalRates, reasonText);
        const consumptionSummary = await upsertConsumption(client, fuel, consumptionRows, intervalRates);
        await client.query('COMMIT');

        appendActivityLog(
            `Imported ${fuel.toUpperCase()} consumption ${startIso}..${endIso} because ${reasonText}; tariffs=${tariffs.map((t) => t.tariff_code).join(',') || 'none'}; `
            + `consumption upserted=${consumptionRows.length} (new ${consumptionSummary.inserted} / updated ${consumptionSummary.updated}); `
            + `rates upserted=${intervalRates.length} (new ${rateSummary.inserted} / updated ${rateSummary.updated}; changed ${rateSummary.changed})`
        );

        return {
            fuel,
            startIso,
            endIso,
            missingRanges,
            tariffs,
            reasonText,
            consumption: consumptionSummary,
            rates: rateSummary,
            fetched: {
                consumption_rows: consumptionRows.length,
                rate_rows: intervalRates.length
            }
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
        await runMigrations(client);

        const electric = await importFuelRange(client, 'electric', start, end, options);
        const gas = await importFuelRange(client, 'gas', start, end, options);
        return { period: { start, end }, electric, gas };
    } finally {
        await client.end();
    }
}

module.exports = { importOctopusData, importFuelRange, ratesToIntervalRows, upsertRateIntervals };
