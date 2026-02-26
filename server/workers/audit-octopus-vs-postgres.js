#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const { loadDbConfig } = require('../../lib/loadDbConfig');
const { appendActivityLog } = require('../../lib/activityLogger');
const { fetchUsageIntervals } = require('../../lib/octopusImporter');
const { localErrorNotify } = require('../../lib/localNotifier');

const dbConfig = loadDbConfig();

const CONFIG = {
    notify: process.env.AUDIT_NOTIFY !== 'false',
    notifyUncertain: false,
    tolElecBucketKwh: Number(process.env.AUDIT_TOL_ELEC_BUCKET_KWH || 0.001),
    tolElecTotalKwh: Number(process.env.AUDIT_TOL_ELEC_TOTAL_KWH || 0.01),
    gasExplainablePct: Number(process.env.AUDIT_GAS_EXPLAINABLE_PCT || 2),
    gasAlertPct: Number(process.env.AUDIT_GAS_ALERT_PCT || 5),
    gasAlertKwh: Number(process.env.AUDIT_GAS_ALERT_KWH || 15),
    maxMonths: Number(process.env.AUDIT_MAX_MONTHS || 24),
    logDir: process.env.AUDIT_LOG_DIR || path.join(__dirname, '../../logs'),
    apiRetries: Number(process.env.AUDIT_API_RETRIES || 3),
    criticalFailThreshold: Number(process.env.AUDIT_CRITICAL_FAILS || 1),
    londonTz: 'Europe/London',
    plausibleGasFactorMin: Number(process.env.AUDIT_GAS_FACTOR_MIN || 10.5),
    plausibleGasFactorMax: Number(process.env.AUDIT_GAS_FACTOR_MAX || 12.5),
    defaultGasFactor: Number(process.env.AUDIT_GAS_DEFAULT_FACTOR || 11.22063333)
};

function parseArgs(argv) {
    const args = {
        mode: 'regular',
        fuel: 'both',
        start: null,
        end: null,
        seed: '42',
        notifyUncertain: false
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];

        if (token === '--notify-uncertain') {
            args.notifyUncertain = true;
            continue;
        }

        if (token.startsWith('--mode=')) {
            args.mode = token.split('=')[1];
            continue;
        }
        if (token === '--mode' && next) {
            args.mode = next;
            i += 1;
            continue;
        }

        if (token.startsWith('--fuel=')) {
            args.fuel = token.split('=')[1];
            continue;
        }
        if (token === '--fuel' && next) {
            args.fuel = next;
            i += 1;
            continue;
        }

        if (token.startsWith('--start=')) {
            args.start = token.split('=')[1];
            continue;
        }
        if (token === '--start' && next) {
            args.start = next;
            i += 1;
            continue;
        }

        if (token.startsWith('--end=')) {
            args.end = token.split('=')[1];
            continue;
        }
        if (token === '--end' && next) {
            args.end = next;
            i += 1;
            continue;
        }

        if (token.startsWith('--seed=')) {
            args.seed = token.split('=')[1];
            continue;
        }
        if (token === '--seed' && next) {
            args.seed = next;
            i += 1;
            continue;
        }
    }

    if (!['full', 'regular', 'spot'].includes(args.mode)) throw new Error('mode must be full|regular|spot');
    if (!['electric', 'gas', 'both'].includes(args.fuel)) throw new Error('fuel must be electric|gas|both');
    return args;
}

function fmt(n, d = 3) { return Number(n || 0).toFixed(d); }
function pct(delta, base) { return base ? (delta / base) * 100 : 0; }
function monthStart(date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)); }
function addMonths(date, n) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1)); }
function addDays(date, n) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d; }
function toIso(d) { return new Date(d).toISOString(); }

function makeRng(seedStr) {
    let x = Number(seedStr) || 42;
    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x / 4294967296;
    };
}

function ensureLogFile() {
    fs.mkdirSync(CONFIG.logDir, { recursive: true });
    return path.join(CONFIG.logDir, `audit-octopus-${new Date().toISOString().slice(0, 10)}.log`);
}

function logLine(logFile, message) {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    appendActivityLog(`[AUDIT] ${message}`);
    fs.appendFileSync(logFile, `${line}\n`, 'utf8');
}

async function withRetry(fn, retries, logFile, label) {
    let attempt = 0;
    let lastError;
    while (attempt < retries) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            attempt += 1;
            const waitMs = 250 * (2 ** (attempt - 1));
            logLine(logFile, `${label} attempt ${attempt}/${retries} failed: ${error.message}; retrying in ${waitMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }
    throw lastError;
}

function bucketExpression(bucket) {
    if (bucket === 'interval') return `start_time`;
    if (bucket === 'day') return `(start_time AT TIME ZONE '${CONFIG.londonTz}')::date`;
    throw new Error(`unsupported bucket ${bucket}`);
}

async function fetchPostgresUsage(client, fuel, fromIso, toIso, bucket) {
    const table = fuel === 'electric' ? 'electric_consumption' : 'gas_consumption';
    const expr = bucketExpression(bucket);

    const q = await client.query(
        `SELECT ${expr} AS bucket,
                SUM(consumption_kwh)::float AS kwh,
                SUM(COALESCE(price_pence,0))::float / 100.0 AS cost_gbp
         FROM ${table}
         WHERE start_time >= $1 AND start_time < $2
         GROUP BY ${expr}
         ORDER BY ${expr}`,
        [fromIso, toIso]
    );

    return q.rows.map((r) => {
        let bucketIso;
        if (bucket === 'interval') {
            bucketIso = new Date(r.bucket).toISOString();
        } else {
            const bucketDate = new Date(r.bucket);
            if (Number.isNaN(bucketDate.getTime())) {
                throw new Error(`Invalid DB day bucket value: ${r.bucket}`);
            }
            bucketIso = new Date(Date.UTC(
                bucketDate.getUTCFullYear(),
                bucketDate.getUTCMonth(),
                bucketDate.getUTCDate(),
                0,
                0,
                0,
                0
            )).toISOString();
        }

        return {
            bucket: bucketIso,
            kwh: Number(r.kwh || 0),
            cost_gbp: Number(r.cost_gbp || 0)
        };
    });
}

function normalizeOctopusRows(rows) {
    return rows
        .map((r) => ({
            interval_start: new Date(r.interval_start).toISOString(),
            interval_end: new Date(r.interval_end).toISOString(),
            consumption: Number(r.consumption || 0)
        }))
        .sort((a, b) => a.interval_start.localeCompare(b.interval_start));
}

function aggregateApiRows(rows, bucket, factor = 1) {
    const map = new Map();
    for (const row of rows) {
        const key = bucket === 'interval'
            ? row.interval_start
            : new Date(new Date(row.interval_start).toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();
        const curr = map.get(key) || { bucket: key, kwh: 0 };
        curr.kwh += Number(row.consumption) * factor;
        map.set(key, curr);
    }
    return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function toMap(rows) {
    const map = new Map();
    rows.forEach((r) => map.set(r.bucket, r));
    return map;
}

function totalKwh(rows) { return rows.reduce((a, r) => a + Number(r.kwh || 0), 0); }

function isEffectivelyZero(value) {
    return Math.abs(Number(value || 0)) <= 0.0005;
}

function clampApiRowsToRange(rows, fromIso, toIso) {
    const fromMs = new Date(fromIso).getTime();
    const toMs = new Date(toIso).getTime();
    return rows.filter((row) => {
        const startMs = new Date(row.interval_start).getTime();
        return startMs >= fromMs && startMs < toMs;
    });
}

function reconcileGasByCVIfNeeded(dbRows, apiRawRows) {
    const apiRawTotal = totalKwh(apiRawRows);
    const dbTotal = totalKwh(dbRows);
    if (apiRawTotal <= 0) {
        return {
            factor: CONFIG.defaultGasFactor,
            explained: false,
            confidence: 0.2,
            reason: 'No API raw usage to infer gas conversion factor.'
        };
    }

    const impliedFactor = dbTotal / apiRawTotal;
    const plausible = impliedFactor >= CONFIG.plausibleGasFactorMin && impliedFactor <= CONFIG.plausibleGasFactorMax;
    const defaultDeltaPct = Math.abs(pct(dbTotal - (apiRawTotal * CONFIG.defaultGasFactor), dbTotal));
    const impliedDeltaPct = Math.abs(pct(dbTotal - (apiRawTotal * impliedFactor), dbTotal));

    if (plausible && impliedDeltaPct <= CONFIG.gasExplainablePct) {
        return {
            factor: impliedFactor,
            explained: true,
            confidence: impliedDeltaPct <= 0.5 ? 0.9 : 0.7,
            reason: `Likely calorific/conversion variance. impliedFactor=${impliedFactor.toFixed(4)} defaultFactor=${CONFIG.defaultGasFactor.toFixed(4)} defaultDelta=${defaultDeltaPct.toFixed(2)}%`
        };
    }

    return {
        factor: CONFIG.defaultGasFactor,
        explained: false,
        confidence: plausible ? 0.45 : 0.2,
        reason: plausible
            ? `Implied factor plausible (${impliedFactor.toFixed(4)}) but residual mismatch remains high (${impliedDeltaPct.toFixed(2)}%).`
            : `Implied factor ${impliedFactor.toFixed(4)} outside plausible range ${CONFIG.plausibleGasFactorMin}-${CONFIG.plausibleGasFactorMax}.`
    };
}

function compareSeries({ fuel, bucket, dbRows, apiRows, mode, periodLabel }) {
    const results = [];
    const keys = [...new Set([...dbRows.map((r) => r.bucket), ...apiRows.map((r) => r.bucket)])].sort();
    const dbMap = toMap(dbRows);
    const apiMap = toMap(apiRows);

    for (const key of keys) {
        const db = dbMap.get(key);
        const api = apiMap.get(key);
        if (!db && api) {
            if (isEffectivelyZero(api.kwh)) {
                continue;
            }
            results.push({ classification: 'FAIL', issue: 'DB GAP', bucket: key, details: `API has ${fmt(api.kwh)} kWh but DB missing` });
            continue;
        }
        if (db && !api) {
            if (isEffectivelyZero(db.kwh)) {
                continue;
            }
            results.push({
                classification: 'UNCERTAIN',
                issue: 'API GAP',
                bucket: key,
                confidence: 0.4,
                details: `DB has ${fmt(db.kwh)} kWh but API missing; retry later to rule out API latency/throttle.`
            });
            continue;
        }

        const delta = Number(db.kwh) - Number(api.kwh);
        const deltaAbs = Math.abs(delta);
        const deltaPct = Math.abs(pct(delta, db.kwh || 1));
        const outlier = deltaAbs >= Math.max(CONFIG.gasAlertKwh, 1) || deltaPct >= 100;

        if (fuel === 'electric') {
            const ok = deltaAbs <= CONFIG.tolElecBucketKwh;
            results.push({
                classification: ok ? 'PASS' : 'FAIL',
                issue: ok ? 'OK' : (outlier ? 'ELECTRIC_OUTLIER' : 'ELECTRIC_MISMATCH'),
                bucket: key,
                details: `Postgres ${fmt(db.kwh)} kWh, API ${fmt(api.kwh)} kWh, Δ ${fmt(deltaAbs)} kWh (${deltaPct.toFixed(3)}%)`
            });
        } else {
            const explainable = deltaPct <= CONFIG.gasExplainablePct;
            if (explainable) {
                results.push({ classification: 'PASS', issue: 'OK', bucket: key, details: `Gas within explainable tolerance: Δ ${deltaPct.toFixed(2)}%` });
            } else {
                const severe = deltaPct > CONFIG.gasAlertPct || deltaAbs > CONFIG.gasAlertKwh;
                results.push({
                    classification: severe ? 'FAIL' : 'UNCERTAIN',
                    confidence: severe ? 0.9 : 0.55,
                    issue: severe ? (outlier ? 'GAS_OUTLIER' : 'GAS_MISMATCH') : 'GAS_UNCERTAIN',
                    bucket: key,
                    details: `Postgres ${fmt(db.kwh)} kWh, API ${fmt(api.kwh)} kWh, Δ ${fmt(deltaAbs)} kWh (${deltaPct.toFixed(2)}%)`
                });
            }
        }
    }

    const summary = {
        mode,
        fuel,
        periodLabel,
        bucket,
        pass: results.filter((r) => r.classification === 'PASS').length,
        fail: results.filter((r) => r.classification === 'FAIL').length,
        uncertain: results.filter((r) => r.classification === 'UNCERTAIN').length,
        results
    };

    return summary;
}

async function fetchOctopusUsageWithRetry(fuel, fromIso, toIso, logFile) {
    const rows = await withRetry(
        () => fetchUsageIntervals(fuel, fromIso, toIso),
        CONFIG.apiRetries,
        logFile,
        `Octopus ${fuel} ${fromIso}..${toIso}`
    );
    return normalizeOctopusRows(rows || []);
}

function monthRangeFromDb(minIso, maxIso, maxMonths) {
    const min = monthStart(new Date(minIso));
    const max = monthStart(new Date(maxIso));
    const out = [];
    let ptr = min;
    while (ptr <= max && out.length < maxMonths) {
        const next = addMonths(ptr, 1);
        out.push({ from: ptr, to: next, label: ptr.toISOString().slice(0, 7) });
        ptr = next;
    }
    return out;
}

async function getTableBounds(client, fuel) {
    const table = fuel === 'electric' ? 'electric_consumption' : 'gas_consumption';
    const q = await client.query(`SELECT MIN(start_time) AS min_t, MAX(start_time) AS max_t FROM ${table}`);
    return q.rows[0];
}

function significantFailures(summary, gasReconcile) {
    if (summary.fuel === 'electric') return summary.results.filter((r) => r.classification === 'FAIL');
    return summary.results.filter((r) => r.classification === 'FAIL' && (!gasReconcile || !gasReconcile.explained));
}

async function notifyIfNeeded(mode, summary, gasReconcile, logFile, notifyUncertain) {
    if (!CONFIG.notify) return;

    const fails = significantFailures(summary, gasReconcile);
    if (fails.length === 0) {
        if (notifyUncertain) {
            const uncertain = summary.results.filter((r) => r.classification === 'UNCERTAIN');
            if (uncertain.length) {
                await localErrorNotify(
                    `Audit uncertain (${mode}/${summary.fuel})`,
                    `${summary.periodLabel}: ${uncertain.length} uncertain discrepancies. See ${logFile}.`,
                    { logFile }
                );
            }
        }
        return;
    }

    const top = fails[0];
    const hypothesis = gasReconcile?.reason || 'No reconciliation hypothesis';
    await localErrorNotify(
        `Audit mismatch (${mode}/${summary.fuel})`,
        `${summary.periodLabel}: ${fails.length} significant fail(s). ${top.details}. Hypothesis: ${hypothesis}. Log: ${logFile}`,
        { logFile }
    );
}

async function runPeriodAudit({ client, mode, fuel, fromIso, toIso, periodLabel, bucket, logFile, notifyUncertain }) {
    const dbRows = await fetchPostgresUsage(client, fuel, fromIso, toIso, bucket);
    const apiRawUnbounded = await fetchOctopusUsageWithRetry(fuel, fromIso, toIso, logFile);
    const apiRaw = clampApiRowsToRange(apiRawUnbounded, fromIso, toIso);

    let apiRows;
    let gasReconcile = null;

    if (fuel === 'gas') {
        const apiRawBucketed = aggregateApiRows(apiRaw, bucket, 1);
        gasReconcile = reconcileGasByCVIfNeeded(dbRows, apiRawBucketed);
        apiRows = aggregateApiRows(apiRaw, bucket, gasReconcile.factor);
    } else {
        apiRows = aggregateApiRows(apiRaw, bucket, 1);
    }

    const summary = compareSeries({ fuel, bucket, dbRows, apiRows, mode, periodLabel });
    const dbTotal = totalKwh(dbRows);
    const apiTotal = totalKwh(apiRows);
    const d = Math.abs(dbTotal - apiTotal);

    if (fuel === 'electric' && d <= CONFIG.tolElecTotalKwh) {
        logLine(logFile, `${mode.toUpperCase()} ${fuel} ${periodLabel}: Postgres total ${fmt(dbTotal)} kWh, API total ${fmt(apiTotal)} kWh (Δ ${fmt(d)}) PASS`);
    } else if (summary.fail > 0) {
        logLine(logFile, `${mode.toUpperCase()} ${fuel} ${periodLabel}: Postgres total ${fmt(dbTotal)} kWh, API total ${fmt(apiTotal)} kWh (Δ ${fmt(d)}) FAIL`);
    } else if (summary.uncertain > 0) {
        logLine(logFile, `${mode.toUpperCase()} ${fuel} ${periodLabel}: Δ ${pct(dbTotal - apiTotal, dbTotal || 1).toFixed(2)}% ${gasReconcile ? `(${gasReconcile.reason})` : ''} UNCERTAIN`);
    } else {
        logLine(logFile, `${mode.toUpperCase()} ${fuel} ${periodLabel}: Postgres total ${fmt(dbTotal)} kWh, API total ${fmt(apiTotal)} kWh (Δ ${fmt(d)}) PASS`);
    }

    const detailLines = summary.results.filter((r) => r.classification !== 'PASS').slice(0, 25);
    detailLines.forEach((item) => {
        const confidence = item.confidence !== undefined ? ` confidence=${item.confidence.toFixed(2)}` : '';
        logLine(logFile, `  ${item.classification} ${item.issue} ${item.bucket}: ${item.details}${confidence}`);
    });

    if (summary.uncertain > 0) {
        logLine(logFile, `  UNCERTAINTY guidance: retry later, check DST boundary alignment (${CONFIG.londonTz}), verify meter conversion/cv assumptions.`);
    }

    await notifyIfNeeded(mode, summary, gasReconcile, logFile, notifyUncertain);
    return summary;
}

async function runFullSweep(client, fuels, args, logFile) {
    const summaries = [];
    for (const fuel of fuels) {
        const bounds = await getTableBounds(client, fuel);
        if (!bounds.min_t || !bounds.max_t) {
            logLine(logFile, `FULL SWEEP ${fuel}: no DB data found; skipping.`);
            continue;
        }

        const start = args.start ? new Date(`${args.start}-01T00:00:00Z`) : new Date(bounds.min_t);
        const end = args.end ? new Date(`${args.end}-01T00:00:00Z`) : new Date(bounds.max_t);
        const ranges = monthRangeFromDb(start.toISOString(), end.toISOString(), CONFIG.maxMonths);

        for (const r of ranges) {
            summaries.push(await runPeriodAudit({
                client,
                mode: 'full',
                fuel,
                fromIso: toIso(r.from),
                toIso: toIso(r.to),
                periodLabel: r.label,
                bucket: 'day',
                logFile,
                notifyUncertain: args.notifyUncertain
            }));
        }
    }
    return summaries;
}

async function runRegularSweep(client, fuels, args, logFile) {
    const summaries = [];
    const end = new Date();
    const start = addMonths(end, -3);
    for (const fuel of fuels) {
        let ptr = new Date(start);
        while (ptr < end) {
            const next = addDays(ptr, 7);
            summaries.push(await runPeriodAudit({
                client,
                mode: 'regular',
                fuel,
                fromIso: toIso(ptr),
                toIso: toIso(next < end ? next : end),
                periodLabel: `${ptr.toISOString().slice(0, 10)}..${(next < end ? next : end).toISOString().slice(0, 10)}`,
                bucket: 'day',
                logFile,
                notifyUncertain: args.notifyUncertain
            }));
            ptr = next;
        }
    }
    return summaries;
}

async function runSpotCheck(client, fuels, args, logFile) {
    const summaries = [];
    const rng = makeRng(args.seed);
    const end = new Date();
    const start = addMonths(end, -12);
    const totalSlots = Math.floor((end - start) / (30 * 60 * 1000));

    for (const fuel of fuels) {
        for (let i = 0; i < 20; i += 1) {
            const slot = Math.floor(rng() * totalSlots);
            const from = new Date(start.getTime() + slot * 30 * 60 * 1000);
            const to = new Date(from.getTime() + 30 * 60 * 1000);
            summaries.push(await runPeriodAudit({
                client,
                mode: 'spot',
                fuel,
                fromIso: toIso(from),
                toIso: toIso(to),
                periodLabel: from.toISOString(),
                bucket: 'interval',
                logFile,
                notifyUncertain: args.notifyUncertain
            }));
        }
    }
    return summaries;
}

function finalStatus(summaries) {
    const rollup = summaries.reduce((acc, s) => {
        acc.pass += s.pass;
        acc.fail += s.fail;
        acc.uncertain += s.uncertain;
        return acc;
    }, { pass: 0, fail: 0, uncertain: 0 });

    return {
        ...rollup,
        exitCode: rollup.fail >= CONFIG.criticalFailThreshold ? 2 : 0
    };
}

async function main() {
    const args = parseArgs(process.argv);
    CONFIG.notifyUncertain = args.notifyUncertain;

    const logFile = ensureLogFile();
    const fuels = args.fuel === 'both' ? ['electric', 'gas'] : [args.fuel];
    logLine(logFile, `Audit worker starting mode=${args.mode} fuel=${args.fuel} seed=${args.seed} tz=${CONFIG.londonTz}`);

    const client = new Client(dbConfig);
    let summaries = [];

    try {
        await client.connect();

        if (args.mode === 'full') summaries = await runFullSweep(client, fuels, args, logFile);
        if (args.mode === 'regular') summaries = await runRegularSweep(client, fuels, args, logFile);
        if (args.mode === 'spot') summaries = await runSpotCheck(client, fuels, args, logFile);

        const status = finalStatus(summaries);
        logLine(logFile, `Audit worker completed: pass=${status.pass} fail=${status.fail} uncertain=${status.uncertain} log=${logFile}`);
        process.exit(status.exitCode);
    } catch (error) {
        logLine(logFile, `Audit worker fatal error: ${error.message}`);
        process.exit(1);
    } finally {
        await client.end().catch(() => null);
    }
}

main();
