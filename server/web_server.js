const express = require('express');
const fs = require('fs');
const { Client } = require('pg');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const { loadDbConfig } = require('../lib/loadDbConfig');
const dbConfig = loadDbConfig();

const app = express();
const port = 52529;
const SESSION_COOKIE_NAME = 'octopus_session';
const SESSION_TTL_MS = Number(process.env.WEB_AUTH_SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const sessionStore = new Map();

// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Middleware to parse incoming JSON data in the request body
app.use(express.json());

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseCookies(req) {
    const header = req.headers.cookie;
    if (!header) {
        return {};
    }

    return header.split(';').reduce((cookies, part) => {
        const [name, ...valueParts] = part.trim().split('=');
        if (!name || valueParts.length === 0) {
            return cookies;
        }
        cookies[name] = decodeURIComponent(valueParts.join('='));
        return cookies;
    }, {});
}

function loadAuthUsers() {
    const usersFile = process.env.WEB_AUTH_USERS_FILE || (fs.existsSync(path.join(__dirname, 'web_users_active.json')) ? path.join(__dirname, 'web_users_active.json') : path.join(__dirname, 'web_users.json'));
    let rawUsers = [];

    if (fs.existsSync(usersFile)) {
        rawUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    } else if (process.env.WEB_AUTH_USERS) {
        rawUsers = JSON.parse(process.env.WEB_AUTH_USERS);
    }

    if (!Array.isArray(rawUsers) || rawUsers.length === 0) {
        throw new Error('Web auth is enabled but no users were found. Provide server/web_users.json or WEB_AUTH_USERS JSON.');
    }

    return rawUsers.map((user) => {
        if (!user.username) {
            throw new Error('Each web auth user must include a username.');
        }

        if (!user.passwordHash || !user.salt) {
            throw new Error(`User ${user.username} must include both salt and passwordHash. Plain-text passwords are not supported.`);
        }

        return { username: user.username, passwordHash: user.passwordHash, salt: user.salt };
    });
}

const authUsers = loadAuthUsers();

function validateCredentials(username, password) {
    if (!username || !password) {
        return false;
    }

    const user = authUsers.find((entry) => entry.username === username);
    if (!user) {
        return false;
    }

    const candidate = crypto.scryptSync(password, user.salt, 64);
    const expected = Buffer.from(user.passwordHash, 'hex');
    if (candidate.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(candidate, expected);
}

function createSession(username) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessionStore.set(sessionId, {
        username,
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    return sessionId;
}

function clearSession(req) {
    const cookies = parseCookies(req);
    if (cookies[SESSION_COOKIE_NAME]) {
        sessionStore.delete(cookies[SESSION_COOKIE_NAME]);
    }
}

function isAuthenticated(req) {
    const cookies = parseCookies(req);
    const sessionId = cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
        return false;
    }

    const session = sessionStore.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
        sessionStore.delete(sessionId);
        return false;
    }

    session.expiresAt = Date.now() + SESSION_TTL_MS;
    req.authUser = session.username;
    return true;
}

function setSessionCookie(req, res, sessionId) {
    const secureCookie = process.env.WEB_AUTH_SECURE_COOKIE === 'true' || req.headers['x-forwarded-proto'] === 'https';
    const secureFlag = secureCookie ? '; Secure' : '';
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; SameSite=Lax${secureFlag}`
    );
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

app.get('/login', (req, res) => {
    const next = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/view-electric';
    const errorMessage = req.query.error ? '<div class="alert alert-danger">Invalid username or password.</div>' : '';

    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Octopus Web Login</title><link href="/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet" /></head><body class="bg-light"><div class="container py-5"><div class="row justify-content-center"><div class="col-md-5"><div class="card shadow-sm"><div class="card-body"><h1 class="h4 mb-3">Octopus Web Login</h1>${errorMessage}<form method="POST" action="/login"><input type="hidden" name="next" value="${escapeHtml(next)}" /><div class="mb-3"><label class="form-label" for="username">Username</label><input class="form-control" id="username" name="username" required autocomplete="username" /></div><div class="mb-3"><label class="form-label" for="password">Password</label><input class="form-control" id="password" type="password" name="password" required autocomplete="current-password" /></div><button class="btn btn-primary w-100" type="submit">Sign in</button></form></div></div></div></div></div></body></html>`);
});

app.post('/login', (req, res) => {
    const next = typeof req.body.next === 'string' && req.body.next.startsWith('/') ? req.body.next : '/view-electric';
    const { username, password } = req.body;

    if (!validateCredentials(username, password)) {
        res.redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
        return;
    }

    const sessionId = createSession(username);
    setSessionCookie(req, res, sessionId);
    res.redirect(next);
});

app.post('/logout', (req, res) => {
    clearSession(req);
    clearSessionCookie(res);
    res.redirect('/login');
});

app.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/logout' || req.path.startsWith('/vendor/') || req.path.startsWith('/public/')) {
        next();
        return;
    }

    if (isAuthenticated(req)) {
        next();
        return;
    }

    const wantsHtml = req.accepts(['html', 'json']) === 'html';
    if (wantsHtml) {
        res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
        return;
    }

    res.status(401).json({ error: 'Authentication required.' });
});

app.get('/', (req, res) => {
    res.redirect('/view-electric');
});


app.get('/logs', (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const lineLimit = Number(req.query.lines || 500);
    const safeLineLimit = Number.isInteger(lineLimit) && lineLimit > 0 ? Math.min(lineLimit, 5000) : 500;
    const logPath = path.join(__dirname, '../logs', `activity-${date}.log`);

    let lines = [];
    let message = '';

    if (fs.existsSync(logPath)) {
        lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-safeLineLimit).reverse();
    } else {
        message = `No activity log found for ${date}.`;
    }

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Activity Logs</title><link href="/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet" /></head><body><div class="container mt-4"><h1>Activity Logs</h1><form class="row g-2 mb-3" method="GET"><div class="col-md-3"><input class="form-control" type="date" name="date" value="${date}" /></div><div class="col-md-3"><input class="form-control" type="number" name="lines" value="${safeLineLimit}" min="1" max="5000" /></div><div class="col-md-2"><button class="btn btn-primary" type="submit">Load</button></div></form>${message ? `<div class="alert alert-info">${message}</div>` : ''}<pre class="bg-light p-3 border rounded" style="white-space: pre-wrap;">${lines.join('\n')}</pre></div></body></html>`);
});


app.use('/vendor/chart.js', express.static(path.join(__dirname, '../node_modules/chart.js/dist')));
app.use('/vendor/bootstrap', express.static(path.join(__dirname, '../node_modules/bootstrap/dist')));
app.use('/public', express.static(path.join(__dirname, '../public')));

function parseUsageQuery(query) {
    const view = ['day', 'week', 'month'].includes(query.view) ? query.view : 'day';
    const date = typeof query.date === 'string' && query.date ? query.date : new Date().toISOString().slice(0, 10);
    const month = typeof query.month === 'string' && /^\d{4}-\d{2}$/.test(query.month)
        ? query.month
        : date.slice(0, 7);

    return {
        view,
        date,
        month,
        includeTypical: query.includeTypical === '1' || query.includeTypical === 'true',
        includeLast: query.includeLast === '1' || query.includeLast === 'true'
    };
}

function fuelTable(fuel) {
    return fuel === 'electric' ? 'electric_consumption' : 'gas_consumption';
}

async function fetchUsageBuckets(client, table, view, date, month) {
    if (view === 'day') {
        const result = await client.query(
            `WITH bounds AS (
                SELECT
                    ($1::date::timestamp AT TIME ZONE 'Europe/London') AS start_utc,
                    (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/London') AS end_utc
            ),
            agg AS (
                SELECT
                    EXTRACT(HOUR FROM (start_time AT TIME ZONE 'Europe/London'))::int AS hour_idx,
                    SUM(consumption_kwh)::float AS kwh,
                    SUM(COALESCE(price_pence, 0))::float / 100.0 AS cost_gbp
                FROM ${table}, bounds
                WHERE start_time >= bounds.start_utc
                  AND start_time < bounds.end_utc
                GROUP BY hour_idx
            )
            SELECT
                gs.hour_idx,
                TO_CHAR(($1::date + MAKE_INTERVAL(hours => gs.hour_idx)), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS bucket_start,
                TO_CHAR(($1::date + MAKE_INTERVAL(hours => gs.hour_idx + 1)), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS bucket_end,
                COALESCE(agg.kwh, 0)::float AS kwh,
                COALESCE(agg.cost_gbp, 0)::float AS cost_gbp
            FROM GENERATE_SERIES(0, 23) AS gs(hour_idx)
            LEFT JOIN agg ON agg.hour_idx = gs.hour_idx
            ORDER BY gs.hour_idx`,
            [date]
        );
        return result.rows;
    }

    if (view === 'week') {
        const result = await client.query(
            `WITH week_bounds AS (
                SELECT
                    (DATE_TRUNC('week', $1::date::timestamp))::date AS week_start
            ),
            days AS (
                SELECT
                    gs.day_idx,
                    (wb.week_start + MAKE_INTERVAL(days => gs.day_idx))::date AS local_day
                FROM week_bounds wb
                CROSS JOIN GENERATE_SERIES(0, 6) AS gs(day_idx)
            ),
            agg AS (
                SELECT
                    (start_time AT TIME ZONE 'Europe/London')::date AS local_day,
                    SUM(consumption_kwh)::float AS kwh,
                    SUM(COALESCE(price_pence, 0))::float / 100.0 AS cost_gbp
                FROM ${table}, week_bounds
                WHERE (start_time AT TIME ZONE 'Europe/London')::date >= week_bounds.week_start
                  AND (start_time AT TIME ZONE 'Europe/London')::date < (week_bounds.week_start + INTERVAL '7 day')
                GROUP BY (start_time AT TIME ZONE 'Europe/London')::date
            )
            SELECT
                days.day_idx,
                TO_CHAR(days.local_day::timestamp, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS bucket_start,
                TO_CHAR((days.local_day::timestamp + INTERVAL '1 day'), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS bucket_end,
                COALESCE(agg.kwh, 0)::float AS kwh,
                COALESCE(agg.cost_gbp, 0)::float AS cost_gbp
            FROM days
            LEFT JOIN agg ON agg.local_day = days.local_day
            ORDER BY days.day_idx`,
            [date]
        );
        return result.rows;
    }

    const result = await client.query(
        `WITH month_bounds AS (
            SELECT
                TO_DATE($1 || '-01', 'YYYY-MM-DD')::date AS month_start,
                (TO_DATE($1 || '-01', 'YYYY-MM-DD') + INTERVAL '1 month')::date AS month_end
        ),
        days AS (
            SELECT
                ROW_NUMBER() OVER () - 1 AS day_idx,
                gs::date AS local_day
            FROM month_bounds mb
            CROSS JOIN GENERATE_SERIES(mb.month_start, mb.month_end - INTERVAL '1 day', INTERVAL '1 day') gs
        ),
        agg AS (
            SELECT
                (start_time AT TIME ZONE 'Europe/London')::date AS local_day,
                SUM(consumption_kwh)::float AS kwh,
                SUM(COALESCE(price_pence, 0))::float / 100.0 AS cost_gbp
            FROM ${table}, month_bounds
            WHERE (start_time AT TIME ZONE 'Europe/London')::date >= month_bounds.month_start
              AND (start_time AT TIME ZONE 'Europe/London')::date < month_bounds.month_end
            GROUP BY (start_time AT TIME ZONE 'Europe/London')::date
        )
        SELECT
            days.day_idx,
            TO_CHAR(days.local_day::timestamp, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS bucket_start,
            TO_CHAR((days.local_day::timestamp + INTERVAL '1 day'), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS bucket_end,
            COALESCE(agg.kwh, 0)::float AS kwh,
            COALESCE(agg.cost_gbp, 0)::float AS cost_gbp
        FROM days
        LEFT JOIN agg ON agg.local_day = days.local_day
        ORDER BY days.local_day`,
        [month]
    );
    return result.rows;
}

async function fetchTypicalBuckets(client, table, view, date, month) {
    if (view === 'day') {
        const countResult = await client.query(
            `SELECT COUNT(*)::int AS days_with_data
             FROM (
                SELECT DISTINCT (start_time AT TIME ZONE 'Europe/London')::date AS local_day
                FROM ${table}
                WHERE (start_time AT TIME ZONE 'Europe/London')::date IN (
                    SELECT ($1::date - (n * INTERVAL '1 week'))::date
                    FROM GENERATE_SERIES(1, 8) AS n
                )
             ) x`,
            [date]
        );
        const weekCount = countResult.rows[0].days_with_data >= 4 ? 8 : 4;

        const result = await client.query(
            `WITH sample_days AS (
                SELECT ($1::date - (n * INTERVAL '1 week'))::date AS local_day
                FROM GENERATE_SERIES(1, $2) AS n
            ),
            hours AS (
                SELECT GENERATE_SERIES(0, 23) AS hour_idx
            ),
            day_hour_grid AS (
                SELECT sample_days.local_day, hours.hour_idx
                FROM sample_days CROSS JOIN hours
            ),
            actual AS (
                SELECT
                    (start_time AT TIME ZONE 'Europe/London')::date AS local_day,
                    EXTRACT(HOUR FROM (start_time AT TIME ZONE 'Europe/London'))::int AS hour_idx,
                    SUM(consumption_kwh)::float AS kwh,
                    SUM(COALESCE(price_pence,0))::float/100.0 AS cost_gbp
                FROM ${table}
                WHERE (start_time AT TIME ZONE 'Europe/London')::date IN (SELECT local_day FROM sample_days)
                GROUP BY 1,2
            )
            SELECT
                dhg.hour_idx,
                AVG(COALESCE(actual.kwh,0))::float AS typical_kwh,
                AVG(COALESCE(actual.cost_gbp,0))::float AS typical_cost_gbp
            FROM day_hour_grid dhg
            LEFT JOIN actual ON actual.local_day = dhg.local_day AND actual.hour_idx = dhg.hour_idx
            GROUP BY dhg.hour_idx
            ORDER BY dhg.hour_idx`,
            [date, weekCount]
        );
        return result.rows;
    }

    if (view === 'week') {
        const result = await client.query(
            `WITH base_week AS (
                SELECT DATE_TRUNC('week', $1::date::timestamp)::date AS week_start
            ),
            sample_weeks AS (
                SELECT (base_week.week_start - (n * INTERVAL '1 week'))::date AS sample_week_start
                FROM base_week, GENERATE_SERIES(1, 8) AS n
            ),
            weekdays AS (
                SELECT GENERATE_SERIES(0, 6) AS day_idx
            ),
            grid AS (
                SELECT sample_weeks.sample_week_start, weekdays.day_idx,
                       (sample_weeks.sample_week_start + MAKE_INTERVAL(days => weekdays.day_idx))::date AS local_day
                FROM sample_weeks CROSS JOIN weekdays
            ),
            actual AS (
                SELECT
                    DATE_TRUNC('week', (start_time AT TIME ZONE 'Europe/London'))::date AS week_start,
                    EXTRACT(ISODOW FROM (start_time AT TIME ZONE 'Europe/London'))::int - 1 AS day_idx,
                    SUM(consumption_kwh)::float AS kwh,
                    SUM(COALESCE(price_pence,0))::float/100.0 AS cost_gbp
                FROM ${table}, base_week
                WHERE (start_time AT TIME ZONE 'Europe/London')::date >= (base_week.week_start - INTERVAL '8 week')
                  AND (start_time AT TIME ZONE 'Europe/London')::date < base_week.week_start
                GROUP BY 1,2
            )
            SELECT
                weekdays.day_idx,
                AVG(COALESCE(actual.kwh,0))::float AS typical_kwh,
                AVG(COALESCE(actual.cost_gbp,0))::float AS typical_cost_gbp
            FROM weekdays
            LEFT JOIN actual ON actual.day_idx = weekdays.day_idx
            GROUP BY weekdays.day_idx
            ORDER BY weekdays.day_idx`,
            [date]
        );
        return result.rows;
    }

    const result = await client.query(
        `WITH month_input AS (
            SELECT TO_DATE($1 || '-01','YYYY-MM-DD')::date AS month_start
        ),
        same_month_years AS (
            SELECT
                EXTRACT(YEAR FROM (start_time AT TIME ZONE 'Europe/London'))::int AS yyyy,
                EXTRACT(DAY FROM (start_time AT TIME ZONE 'Europe/London'))::int AS day_of_month,
                SUM(consumption_kwh)::float AS kwh,
                SUM(COALESCE(price_pence,0))::float/100.0 AS cost_gbp
            FROM ${table}, month_input
            WHERE EXTRACT(MONTH FROM (start_time AT TIME ZONE 'Europe/London')) = EXTRACT(MONTH FROM month_input.month_start)
              AND EXTRACT(YEAR FROM (start_time AT TIME ZONE 'Europe/London')) < EXTRACT(YEAR FROM month_input.month_start)
            GROUP BY 1,2
        ),
        month_days AS (
            SELECT GENERATE_SERIES(1, EXTRACT(DAY FROM ((DATE_TRUNC('month', month_start) + INTERVAL '1 month - 1 day'))::date)::int) AS day_of_month
            FROM month_input
        ),
        same_month_agg AS (
            SELECT
                month_days.day_of_month,
                AVG(COALESCE(smy.kwh,0))::float AS typical_kwh,
                AVG(COALESCE(smy.cost_gbp,0))::float AS typical_cost_gbp,
                COUNT(DISTINCT smy.yyyy)::int AS sample_years
            FROM month_days
            LEFT JOIN same_month_years smy ON smy.day_of_month = month_days.day_of_month
            GROUP BY month_days.day_of_month
        ),
        fallback AS (
            SELECT
                EXTRACT(DAY FROM day_totals.local_day)::int AS day_of_month,
                AVG(day_totals.kwh)::float AS typical_kwh,
                AVG(day_totals.cost_gbp)::float AS typical_cost_gbp
            FROM (
                SELECT
                    (start_time AT TIME ZONE 'Europe/London')::date AS local_day,
                    SUM(consumption_kwh)::float AS kwh,
                    SUM(COALESCE(price_pence,0))::float/100.0 AS cost_gbp
                FROM ${table}, month_input
                WHERE (start_time AT TIME ZONE 'Europe/London')::date >= (month_input.month_start - INTERVAL '3 month')
                  AND (start_time AT TIME ZONE 'Europe/London')::date < month_input.month_start
                GROUP BY 1
            ) AS day_totals
            GROUP BY EXTRACT(DAY FROM day_totals.local_day)
        ),
        sample_check AS (
            SELECT COALESCE(MAX(sample_years),0) AS sample_years FROM same_month_agg
        )
        SELECT
            md.day_of_month - 1 AS day_idx,
            CASE WHEN sc.sample_years > 0 THEN COALESCE(sma.typical_kwh,0) ELSE COALESCE(f.typical_kwh,0) END::float AS typical_kwh,
            CASE WHEN sc.sample_years > 0 THEN COALESCE(sma.typical_cost_gbp,0) ELSE COALESCE(f.typical_cost_gbp,0) END::float AS typical_cost_gbp
        FROM (
            SELECT GENERATE_SERIES(1, EXTRACT(DAY FROM ((DATE_TRUNC('month', month_start) + INTERVAL '1 month - 1 day'))::date)::int) AS day_of_month
            FROM month_input
        ) md
        CROSS JOIN sample_check sc
        LEFT JOIN same_month_agg sma ON sma.day_of_month = md.day_of_month
        LEFT JOIN fallback f ON f.day_of_month = md.day_of_month
        ORDER BY md.day_of_month`,
        [month]
    );
    return result.rows;
}

function mergeOverlays(rows, typicalRows, lastRows) {
    const byIdx = (arr, key) => new Map(arr.map((r) => [Number(r[key] ?? r.day_idx ?? r.hour_idx), r]));
    const typicalMap = byIdx(typicalRows || [], 'hour_idx');
    const lastMap = byIdx(lastRows || [], 'hour_idx');

    return rows.map((row, idx) => {
        const t = typicalMap.get(idx) || typicalMap.get(Number(row.day_idx)) || {};
        const l = lastMap.get(idx) || lastMap.get(Number(row.day_idx)) || {};
        return {
            bucket_start: row.bucket_start,
            bucket_end: row.bucket_end,
            kwh: Number(row.kwh || 0),
            cost_gbp: Number(row.cost_gbp || 0),
            typical_kwh: t.typical_kwh !== undefined ? Number(t.typical_kwh || 0) : null,
            typical_cost_gbp: t.typical_cost_gbp !== undefined ? Number(t.typical_cost_gbp || 0) : null,
            last_period_kwh: l.kwh !== undefined ? Number(l.kwh || 0) : null,
            last_period_cost_gbp: l.cost_gbp !== undefined ? Number(l.cost_gbp || 0) : null
        };
    });
}

function sumField(rows, field) {
    return rows.reduce((acc, r) => acc + Number(r[field] || 0), 0);
}

function buildUsageMetadata(fuel, query, rows) {
    return {
        fuel,
        view: query.view,
        date: query.date,
        month: query.month,
        includeTypical: query.includeTypical,
        includeLast: query.includeLast,
        rangeStart: rows[0]?.bucket_start || null,
        rangeEnd: rows[rows.length - 1]?.bucket_end || null,
        createdAt: new Date().toISOString(),
        timezone: 'Europe/London'
    };
}

async function getUsagePayload(client, fuel, query) {
    const table = fuelTable(fuel);
    const rows = await fetchUsageBuckets(client, table, query.view, query.date, query.month);

    let typicalRows = [];
    if (query.includeTypical) {
        typicalRows = await fetchTypicalBuckets(client, table, query.view, query.date, query.month);
    }

    let lastRows = [];
    if (query.includeLast) {
        if (query.view === 'day') {
            const lastDate = await client.query(`SELECT ($1::date - INTERVAL '7 day')::date::text AS d`, [query.date]);
            lastRows = await fetchUsageBuckets(client, table, 'day', lastDate.rows[0].d, query.month);
        } else if (query.view === 'week') {
            const lastWeekDate = await client.query(`SELECT ($1::date - INTERVAL '7 day')::date::text AS d`, [query.date]);
            lastRows = await fetchUsageBuckets(client, table, 'week', lastWeekDate.rows[0].d, query.month);
        } else {
            const parts = query.month.split('-');
            const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 2, 1));
            const lastMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
            lastRows = await fetchUsageBuckets(client, table, 'month', query.date, lastMonth);
        }
    }

    const mergedRows = mergeOverlays(rows, typicalRows, lastRows);
    const totals = {
        kwh: sumField(mergedRows, 'kwh'),
        cost_gbp: sumField(mergedRows, 'cost_gbp'),
        typical_kwh: query.includeTypical ? sumField(mergedRows, 'typical_kwh') : null,
        typical_cost_gbp: query.includeTypical ? sumField(mergedRows, 'typical_cost_gbp') : null,
        last_period_kwh: query.includeLast ? sumField(mergedRows, 'last_period_kwh') : null,
        last_period_cost_gbp: query.includeLast ? sumField(mergedRows, 'last_period_cost_gbp') : null
    };

    return {
        metadata: buildUsageMetadata(fuel, query, mergedRows),
        totals,
        rows: mergedRows
    };
}

function csvEscape(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(payload) {
    const lines = [];
    const m = payload.metadata;
    lines.push(`fuel,${csvEscape(m.fuel)}`);
    lines.push(`view,${csvEscape(m.view)}`);
    lines.push(`date,${csvEscape(m.date)}`);
    lines.push(`month,${csvEscape(m.month)}`);
    lines.push(`range_start,${csvEscape(m.rangeStart)}`);
    lines.push(`range_end,${csvEscape(m.rangeEnd)}`);
    lines.push(`created_at,${csvEscape(m.createdAt)}`);
    lines.push('');
    lines.push('bucket_start,bucket_end,kwh,cost_gbp,typical_kwh,typical_cost_gbp,last_period_kwh,last_period_cost_gbp');
    payload.rows.forEach((row) => {
        lines.push([
            row.bucket_start,
            row.bucket_end,
            row.kwh,
            row.cost_gbp,
            row.typical_kwh,
            row.typical_cost_gbp,
            row.last_period_kwh,
            row.last_period_cost_gbp
        ].map(csvEscape).join(','));
    });
    return lines.join('\n');
}

function renderUsageDashboardPage(fuel) {
    const title = fuel === 'electric' ? 'Electric Usage Dashboard' : 'Gas Usage Dashboard';
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css" />
    <style>
        body { background: #f4f6fa; }
        .summary-card { border: 0; box-shadow: 0 0.125rem 0.5rem rgba(0,0,0,.08); }
        .table-wrap { overflow-x:auto; }
    </style>
</head>
<body>
    <main class="container-fluid px-3 px-md-4 py-4" data-fuel="${fuel}" id="usage-dashboard-root">
        <div class="d-flex flex-wrap justify-content-between align-items-center mb-3">
            <h1 class="h3 mb-2 mb-md-0">${title}</h1>
            <div class="btn-group" role="group">
                <a class="btn btn-outline-secondary" href="/view-electric">Electric</a>
                <a class="btn btn-outline-secondary" href="/view-gas">Gas</a>
            </div>
        </div>

        <section class="card mb-3">
            <div class="card-body">
                <div class="row g-2 align-items-end">
                    <div class="col-12 col-md-4">
                        <label class="form-label">View</label>
                        <div class="btn-group w-100" role="group" id="viewModeGroup">
                            <button class="btn btn-primary" data-view="day">Day</button>
                            <button class="btn btn-outline-primary" data-view="week">Week</button>
                            <button class="btn btn-outline-primary" data-view="month">Month</button>
                        </div>
                    </div>
                    <div class="col-8 col-md-3">
                        <label class="form-label" for="dateInput">Date</label>
                        <input id="dateInput" class="form-control" type="date" />
                    </div>
                    <div class="col-4 col-md-2 d-grid">
                        <button id="todayBtn" class="btn btn-outline-secondary">Today</button>
                    </div>
                    <div class="col-6 col-md-1 d-grid">
                        <button id="prevBtn" class="btn btn-outline-dark">Prev</button>
                    </div>
                    <div class="col-6 col-md-1 d-grid">
                        <button id="nextBtn" class="btn btn-outline-dark">Next</button>
                    </div>
                    <div class="col-12 col-md-1 d-grid">
                        <div class="dropdown">
                            <button class="btn btn-success dropdown-toggle w-100" type="button" data-bs-toggle="dropdown" aria-expanded="false">Export</button>
                            <ul class="dropdown-menu dropdown-menu-end">
                                <li><button class="dropdown-item" data-export="csv">CSV</button></li>
                                <li><button class="dropdown-item" data-export="json">JSON</button></li>
                                <li><button class="dropdown-item" data-export="xlsx">XLSX</button></li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div class="row g-2 mt-2">
                    <div class="col-12 col-md-4">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="includeTypical" />
                            <label class="form-check-label" for="includeTypical">Show typical usage</label>
                        </div>
                    </div>
                    <div class="col-12 col-md-4">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="includeLast" />
                            <label class="form-check-label" for="includeLast">Overlay last period</label>
                        </div>
                    </div>
                    <div class="col-12 col-md-4">
                        <div class="btn-group" role="group" id="metricGroup">
                            <button class="btn btn-sm btn-primary" data-metric="kwh">kWh</button>
                            <button class="btn btn-sm btn-outline-primary" data-metric="cost">£</button>
                        </div>
                    </div>
                </div>
                <div id="dashboardError" class="alert alert-danger mt-3 d-none"></div>
            </div>
        </section>

        <section class="row g-3 mb-3" id="summaryCards">
            <div class="col-12 col-md-4"><div class="card summary-card"><div class="card-body"><h2 class="h6 text-muted">Total kWh</h2><div class="h3" id="sumKwh">-</div></div></div></div>
            <div class="col-12 col-md-4"><div class="card summary-card"><div class="card-body"><h2 class="h6 text-muted">Total £</h2><div class="h3" id="sumCost">-</div></div></div></div>
            <div class="col-12 col-md-4"><div class="card summary-card"><div class="card-body"><h2 class="h6 text-muted">Delta</h2><div class="h6 mb-0" id="sumDelta">Enable Typical/Last Period</div></div></div></div>
        </section>

        <section class="card mb-3">
            <div class="card-body">
                <div id="loadingState" class="text-center py-5 d-none"><div class="spinner-border text-primary" role="status"></div></div>
                <canvas id="usageChart" height="90"></canvas>
            </div>
        </section>

        <section class="card">
            <div class="card-body table-wrap">
                <table class="table table-sm table-striped table-hover" id="usageTable">
                    <thead>
                        <tr>
                            <th data-sort="bucket_start">Bucket Start</th>
                            <th data-sort="bucket_end">Bucket End</th>
                            <th data-sort="kwh">kWh</th>
                            <th data-sort="cost_gbp">£</th>
                            <th data-sort="typical_kwh">Typical kWh</th>
                            <th data-sort="typical_cost_gbp">Typical £</th>
                            <th data-sort="last_period_kwh">Last kWh</th>
                            <th data-sort="last_period_cost_gbp">Last £</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                    <tfoot>
                        <tr class="fw-bold">
                            <td colspan="2">Totals</td>
                            <td id="totKwh"></td>
                            <td id="totCost"></td>
                            <td id="totTypicalKwh"></td>
                            <td id="totTypicalCost"></td>
                            <td id="totLastKwh"></td>
                            <td id="totLastCost"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>
    </main>

    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/chart.js/chart.umd.js"></script>
    <script src="/public/js/usage-dashboard.js"></script>
</body>
</html>`;
}

app.get('/view-electric', (req, res) => {
    res.send(renderUsageDashboardPage('electric'));
});

app.get('/view-gas', (req, res) => {
    res.send(renderUsageDashboardPage('gas'));
});

app.get('/api/usage/:fuel', async (req, res) => {
    const fuel = req.params.fuel;
    if (!['electric', 'gas'].includes(fuel)) {
        return res.status(400).json({ error: 'Unsupported fuel.' });
    }

    const usageQuery = parseUsageQuery(req.query);
    const client = new Client(dbConfig);

    try {
        await client.connect();
        const payload = await getUsagePayload(client, fuel, usageQuery);
        res.json(payload);
    } catch (error) {
        console.error('Error fetching usage dashboard data:', error);
        res.status(500).json({ error: error.message });
    } finally {
        await client.end();
    }
});

app.get('/api/usage/:fuel/export', async (req, res) => {
    const fuel = req.params.fuel;
    if (!['electric', 'gas'].includes(fuel)) {
        return res.status(400).json({ error: 'Unsupported fuel.' });
    }

    const format = ['csv', 'json', 'xlsx'].includes(req.query.format) ? req.query.format : 'csv';
    const usageQuery = parseUsageQuery(req.query);
    const client = new Client(dbConfig);

    try {
        await client.connect();
        const payload = await getUsagePayload(client, fuel, usageQuery);
        const filename = `usage_${fuel}_${usageQuery.view}_${new Date().toISOString().slice(0, 10)}`;

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=\"${filename}.json\"`);
            res.send(JSON.stringify(payload, null, 2));
            return;
        }

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=\"${filename}.csv\"`);
            res.send(toCsv(payload));
            return;
        }

        const workbook = XLSX.utils.book_new();
        const metaRows = Object.entries(payload.metadata).map(([k, v]) => ({ key: k, value: v }));
        const dataRows = payload.rows.map((row) => ({
            bucket_start: row.bucket_start,
            bucket_end: row.bucket_end,
            kwh: row.kwh,
            cost_gbp: row.cost_gbp,
            typical_kwh: row.typical_kwh,
            typical_cost_gbp: row.typical_cost_gbp,
            last_period_kwh: row.last_period_kwh,
            last_period_cost_gbp: row.last_period_cost_gbp
        }));
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metaRows), 'metadata');
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(dataRows), 'rows');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=\"${filename}.xlsx\"`);
        res.send(buffer);
    } catch (error) {
        console.error('Error exporting usage dashboard data:', error);
        res.status(500).json({ error: error.message });
    } finally {
        await client.end();
    }
});


app.get('/view-ohme-events', async (req, res) => {
    const client = new Client(dbConfig);

    const rawLimit = Number(req.query.limit);
    const limit = [10, 25, 50].includes(rawLimit) ? rawLimit : 10;
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const vehicleFilter = ['Audi', 'BMW', 'unknown', 'all'].includes(req.query.vehicle)
        ? req.query.vehicle
        : 'all';

    try {
        await client.connect();

        await client.query(`
            CREATE TABLE IF NOT EXISTS ohme_charge_events (
                id BIGSERIAL PRIMARY KEY,
                charge_started TIMESTAMPTZ NOT NULL,
                charge_ended TIMESTAMPTZ NOT NULL,
                duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
                kwh_estimated NUMERIC(12, 6) NOT NULL DEFAULT 0,
                cross_checked BOOLEAN NOT NULL DEFAULT FALSE,
                price NUMERIC(12, 6),
                vehicle TEXT NOT NULL DEFAULT 'unknown' CHECK (vehicle IN ('Audi', 'BMW', 'unknown')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (charge_started, charge_ended)
            );
        `);

        const whereClause = vehicleFilter === 'all' ? '' : 'WHERE vehicle = $1';
        const queryParams = vehicleFilter === 'all' ? [limit, offset] : [vehicleFilter, limit, offset];
        const limitPlaceholder = vehicleFilter === 'all' ? '$1' : '$2';
        const offsetPlaceholder = vehicleFilter === 'all' ? '$2' : '$3';

        const result = await client.query(
            `SELECT id, charge_started, charge_ended, duration_minutes, kwh_estimated, cross_checked, vehicle
             FROM ohme_charge_events
             ${whereClause}
             ORDER BY charge_started DESC
             LIMIT ${limitPlaceholder}
             OFFSET ${offsetPlaceholder}`,
            queryParams
        );

        const countResult = await client.query(
            `SELECT COUNT(*)::int AS total_rows
             FROM ohme_charge_events
             ${whereClause}`,
            vehicleFilter === 'all' ? [] : [vehicleFilter]
        );

        const totalRows = countResult.rows[0]?.total_rows || 0;
        const totalPages = Math.max(1, Math.ceil(totalRows / limit));

        const rowsHtml = result.rows.map((row) => {
            const start = new Date(row.charge_started);
            const end = new Date(row.charge_ended);
            const startLabel = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const endLabel = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const kwh = Number(row.kwh_estimated || 0);
            const costGbp = (kwh * 0.07).toFixed(2);

            return `
                <tr data-vehicle="${row.vehicle}" data-start="${start.toISOString()}" data-kwh="${kwh.toFixed(3)}" data-cost="${costGbp}">
                    <td>${row.id}</td>
                    <td>${start.toLocaleDateString('en-GB')} ${startLabel}</td>
                    <td>${end.toLocaleDateString('en-GB')} ${endLabel}</td>
                    <td>${row.duration_minutes}</td>
                    <td>${kwh.toFixed(3)}</td>
                    <td>£${costGbp}</td>
                    <td>
                        <div class="form-check form-switch">
                            <input class="form-check-input js-cross-check" type="checkbox" data-id="${row.id}" ${row.cross_checked ? 'checked' : ''}>
                        </div>
                    </td>
                    <td>
                        <select class="form-select form-select-sm js-vehicle" data-id="${row.id}">
                            <option value="Audi" ${row.vehicle === 'Audi' ? 'selected' : ''}>Audi</option>
                            <option value="BMW" ${row.vehicle === 'BMW' ? 'selected' : ''}>BMW</option>
                            <option value="unknown" ${row.vehicle === 'unknown' ? 'selected' : ''}>unknown</option>
                        </select>
                    </td>
                </tr>
            `;
        }).join('');

        const chartPoints = result.rows
            .map((row) => ({
                x: new Date(row.charge_started).toISOString(),
                y: Number(row.kwh_estimated || 0)
            }))
            .sort((a, b) => new Date(a.x) - new Date(b.x));

        const buildPageLink = (targetPage) => {
            const params = new URLSearchParams();
            params.set('page', String(targetPage));
            params.set('limit', String(limit));
            params.set('vehicle', vehicleFilter);
            return `/view-ohme-events?\${params.toString()}`;
        };

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ohme Charge Events Dashboard</title>
    <link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css" />
    <style>
        body { background: #f4f6fa; }
        .summary-card { border: 0; box-shadow: 0 0.125rem 0.5rem rgba(0,0,0,.08); }
        .table-wrap { overflow-x:auto; }
        .filter-input { width: 100%; min-width: 90px; }
    </style>
</head>
<body>
    <main class="container-fluid px-3 px-md-4 py-4">
        <div class="d-flex flex-wrap justify-content-between align-items-center mb-3">
            <h1 class="h3 mb-2 mb-md-0">Ohme Charge Events</h1>
            <div class="btn-group" role="group">
                <a class="btn btn-outline-secondary" href="/view-electric">Electric</a>
                <a class="btn btn-outline-secondary" href="/view-gas">Gas</a>
                <a class="btn btn-outline-secondary" href="/view_charging_events">Legacy Charging</a>
            </div>
        </div>

        <section class="card mb-3 summary-card">
            <div class="card-body">
                <div class="row g-2 align-items-end">
                    <div class="col-6 col-md-2">
                        <label class="form-label" for="limitSelect">Rows</label>
                        <select id="limitSelect" class="form-select">
                            <option value="10" ${limit === 10 ? 'selected' : ''}>10</option>
                            <option value="25" ${limit === 25 ? 'selected' : ''}>25</option>
                            <option value="50" ${limit === 50 ? 'selected' : ''}>50</option>
                        </select>
                    </div>
                    <div class="col-6 col-md-3">
                        <label class="form-label" for="vehicleFilter">Vehicle</label>
                        <select id="vehicleFilter" class="form-select">
                            <option value="all" ${vehicleFilter === 'all' ? 'selected' : ''}>All</option>
                            <option value="Audi" ${vehicleFilter === 'Audi' ? 'selected' : ''}>Audi</option>
                            <option value="BMW" ${vehicleFilter === 'BMW' ? 'selected' : ''}>BMW</option>
                            <option value="unknown" ${vehicleFilter === 'unknown' ? 'selected' : ''}>unknown</option>
                        </select>
                    </div>
                    <div class="col-12 col-md-7 d-flex justify-content-md-end gap-2">
                        <a class="btn btn-outline-dark ${page <= 1 ? 'disabled' : ''}" href="${buildPageLink(Math.max(1, page - 1))}">Older</a>
                        <a class="btn btn-outline-dark ${page >= totalPages ? 'disabled' : ''}" href="${buildPageLink(Math.min(totalPages, page + 1))}">Newer</a>
                        <span class="align-self-center text-muted">Page ${page} of ${totalPages} (${totalRows} rows)</span>
                    </div>
                </div>
                <p class="mt-3 mb-0">Cost uses fixed 7p/kWh for display only (does not write to <code>price</code>).</p>
            </div>
        </section>

        <section class="card mb-3">
            <div class="card-body">
                <canvas id="ohmeEventsChart" height="90"></canvas>
            </div>
        </section>

        <section class="card">
            <div class="card-body table-wrap">
                <table class="table table-sm table-striped table-hover" id="ohmeEventsTable">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Start</th>
                            <th>End</th>
                            <th>Duration (min)</th>
                            <th>kWh</th>
                            <th>Cost (£ @ 7p)</th>
                            <th>Cross Checked</th>
                            <th>Vehicle</th>
                        </tr>
                        <tr>
                            <th><input class="form-control form-control-sm filter-input" data-column="0" placeholder="Filter ID" /></th>
                            <th><input class="form-control form-control-sm filter-input" data-column="1" placeholder="Filter start" /></th>
                            <th><input class="form-control form-control-sm filter-input" data-column="2" placeholder="Filter end" /></th>
                            <th><input class="form-control form-control-sm filter-input" data-column="3" placeholder="Filter duration" /></th>
                            <th><input class="form-control form-control-sm filter-input" data-column="4" placeholder="Filter kWh" /></th>
                            <th><input class="form-control form-control-sm filter-input" data-column="5" placeholder="Filter cost" /></th>
                            <th><input class="form-control form-control-sm filter-input" data-column="6" placeholder="Filter checked" /></th>
                            <th><input class="form-control form-control-sm filter-input" data-column="7" placeholder="Filter vehicle" /></th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </section>
    </main>

    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/chart.js/chart.umd.js"></script>
    <script>
        const chartPoints = ${JSON.stringify(chartPoints)};

        const ctx = document.getElementById('ohmeEventsChart').getContext('2d');
        const chartLabels = chartPoints.map((p) => new Date(p.x).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
        const chartValues = chartPoints.map((p) => p.y);

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: 'Ohme Event kWh',
                    data: chartValues,
                    borderColor: '#0d6efd',
                    backgroundColor: 'rgba(13, 110, 253, 0.15)',
                    pointRadius: 3,
                    tension: 0.2
                }]
            },
            options: {
                scales: {
                    x: {
                        title: { display: true, text: 'Time/Date' }
                    },
                    y: {
                        title: { display: true, text: 'kWh' }
                    }
                }
            }
        });

        async function postJson(url, body) {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                const txt = await response.text();
                throw new Error(txt || 'Request failed');
            }
        }

        const limitSelect = document.getElementById('limitSelect');
        const vehicleFilter = document.getElementById('vehicleFilter');

        function rebuildQuery() {
            const params = new URLSearchParams(window.location.search);
            params.set('limit', limitSelect.value);
            params.set('vehicle', vehicleFilter.value);
            params.set('page', '1');
            window.location.href = '/view-ohme-events?' + params.toString();
        }

        limitSelect.addEventListener('change', rebuildQuery);
        vehicleFilter.addEventListener('change', rebuildQuery);

        document.querySelectorAll('.js-cross-check').forEach((el) => {
            el.addEventListener('change', async () => {
                try {
                    await postJson('/api/ohme-events/update-cross-checked', {
                        id: Number(el.dataset.id),
                        cross_checked: el.checked
                    });
                } catch (error) {
                    alert('Failed to update cross_checked: ' + error.message);
                    el.checked = !el.checked;
                }
            });
        });

        document.querySelectorAll('.js-vehicle').forEach((el) => {
            el.addEventListener('change', async () => {
                try {
                    await postJson('/api/ohme-events/update-vehicle', {
                        id: Number(el.dataset.id),
                        vehicle: el.value
                    });
                } catch (error) {
                    alert('Failed to update vehicle: ' + error.message);
                }
            });
        });

        const table = document.getElementById('ohmeEventsTable');
        const filters = Array.from(document.querySelectorAll('.filter-input'));

        function applyFilters() {
            const rows = Array.from(table.querySelectorAll('tbody tr'));
            rows.forEach((row) => {
                const cells = Array.from(row.querySelectorAll('td'));
                const isMatch = filters.every((filterInput) => {
                    const value = filterInput.value.trim().toLowerCase();
                    if (!value) return true;
                    const column = Number(filterInput.dataset.column);
                    const text = (cells[column]?.innerText || '').toLowerCase();
                    return text.includes(value);
                });
                row.style.display = isMatch ? '' : 'none';
            });
        }

        filters.forEach((input) => {
            input.addEventListener('input', applyFilters);
        });
    </script>
</body>
</html>`);
    } catch (error) {
        console.error('Error loading Ohme events page:', error);
        res.status(500).send('Error loading Ohme events page');
    } finally {
        await client.end();
    }
});

app.post('/api/ohme-events/update-cross-checked', async (req, res) => {
    const { id, cross_checked } = req.body;

    if (!Number.isInteger(id)) {
        return res.status(400).send('Invalid id');
    }

    const client = new Client(dbConfig);
    try {
        await client.connect();
        const result = await client.query(
            'UPDATE ohme_charge_events SET cross_checked = $1, updated_at = NOW() WHERE id = $2',
            [Boolean(cross_checked), id]
        );

        if (result.rowCount === 0) {
            return res.status(404).send('Event not found');
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Failed to update cross_checked:', error);
        res.status(500).send('Failed to update cross_checked');
    } finally {
        await client.end();
    }
});

app.post('/api/ohme-events/update-vehicle', async (req, res) => {
    const { id, vehicle } = req.body;
    const valid = ['Audi', 'BMW', 'unknown'];

    if (!Number.isInteger(id)) {
        return res.status(400).send('Invalid id');
    }

    if (!valid.includes(vehicle)) {
        return res.status(400).send('Invalid vehicle');
    }

    const client = new Client(dbConfig);
    try {
        await client.connect();
        const result = await client.query(
            'UPDATE ohme_charge_events SET vehicle = $1, updated_at = NOW() WHERE id = $2',
            [vehicle, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).send('Event not found');
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Failed to update vehicle:', error);
        res.status(500).send('Failed to update vehicle');
    } finally {
        await client.end();
    }
});

// Serve the charging events page
app.get('/view_charging_events', async (req, res) => {
    const { startDate, endDate } = req.query;

    const client = new Client(dbConfig);
    let query = `
        SELECT id, start_time, end_time, energy_used, estimated_cost, 
               settled, percent_charged, ignore_event, comment
        FROM charging_events
    `;
    let queryParams = [];

    if (startDate && endDate) {
        query += ' WHERE start_time >= $1 AND end_time <= $2';
        queryParams.push(startDate, endDate);
    }

    query += ' ORDER BY start_time';

    try {
        await client.connect();
        const result = await client.query(query, queryParams);

        let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Charging Events Data</title>
            <link href="/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet">
            <link rel="stylesheet" href="https://unpkg.com/bootstrap-table@1.21.1/dist/bootstrap-table.min.css">
        </head>
        <body>
            <div class="container mt-4">
                <h1>Charging Events Data</h1>

                <form method="GET" class="mb-4">
                    <div class="row">
                        <div class="col-md-5">
                            <input type="datetime-local" name="startDate" class="form-control" value="${startDate || ''}" required>
                        </div>
                        <div class="col-md-5">
                            <input type="datetime-local" name="endDate" class="form-control" value="${endDate || ''}" required>
                        </div>
                        <div class="col-md-2">
                            <button type="submit" class="btn btn-primary">Filter</button>
                        </div>
                    </div>
                </form>

                <button id="exportBtn" class="btn btn-primary mb-3">Export to CSV</button>
                <table 
                    id="chargingEventsTable" 
                    class="table table-bordered table-hover"
                    data-toggle="table" 
                    data-search="true" 
                    data-pagination="true"
                    data-show-columns="true"
                    data-page-size="10" 
                    data-page-list="[5, 10, 20, 50]"
                    data-toolbar="#toolbar">
                    <thead>
                        <tr>
                            <th data-field="id" data-sortable="true">ID</th>
                            <th data-field="start_time" data-sortable="true">Start Time</th>
                            <th data-field="end_time" data-sortable="true">End Time</th>
                            <th data-field="energy_used" data-sortable="true">Energy Used (kWh)</th>
                            <th data-field="estimated_cost" data-sortable="true">Estimated Cost (£)</th>
                            <th data-field="settled" data-sortable="true">Settled</th>
                            <th data-field="percent_charged" data-sortable="true">Percent Charged (%)</th>
                            <th data-field="ignore_event" data-sortable="true">Ignore Event</th>
                            <th data-field="comment" data-sortable="true">Comment</th>  <!-- Added Comment Column -->
                        </tr>
                    </thead>
                    <tbody>`;

        result.rows.forEach(row => {
            let estimatedCostFormatted = row.estimated_cost
            ? `£${(Math.round(row.estimated_cost) / 100).toFixed(2)}`
            : 'N/A';
            let comment = row.comment || 'N/A';  // Default 'N/A' if no comment
            html += `
            <tr>
                <td><a href="/view_charge_event/${row.id}">${row.id}</a></td> <!-- Make Row ID clickable -->
                <td>${new Date(row.start_time).toLocaleString()}</td>
                <td>${row.end_time ? new Date(row.end_time).toLocaleString() : ''}</td>
                <td>${row.energy_used ? parseFloat(row.energy_used).toFixed(3) : ''}</td>
                <td>${estimatedCostFormatted}</td>
                <td>${row.settled ? 'Yes' : 'No'}</td>
                <td>${row.percent_charged || ''}</td>
                <td>${row.ignore_event ? 'Yes' : 'No'}</td>
                <td>${comment}</td> <!-- Added Comment to the table -->
            </tr>`;
        });

        html += `
                    </tbody>
                </table>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
            <script src="https://unpkg.com/bootstrap-table@1.21.1/dist/bootstrap-table.min.js"></script>
            <script src="https://unpkg.com/bootstrap-table@1.21.1/dist/extensions/export/bootstrap-table-export.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.16.9/xlsx.full.min.js"></script>
            <script>
                document.getElementById('exportBtn').addEventListener('click', function() {
                    const table = document.getElementById('chargingEventsTable');
                    const wb = XLSX.utils.table_to_book(table, { sheet: 'Charging Events' });
                    XLSX.writeFile(wb, 'charging_events.xlsx');
                });
            </script>
        </body>
        </html>`;

        res.send(html);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    } finally {
        await client.end();
    }
});




// Serve the detailed view for a specific charging event
app.get('/view_charge_event/:id_number', async (req, res) => {
    const { id_number } = req.params;
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Query the specific charging event by ID
        const result = await client.query(`
            SELECT id, start_time, end_time, energy_used, estimated_cost, settled, percent_charged, ignore_event, comment
            FROM charging_events 
            WHERE id = $1
        `, [id_number]);

        if (result.rows.length === 0) {
            res.status(404).send('Charging event not found.');
            return;
        }

        const event = result.rows[0];

        // Format estimated_cost from pence to pounds and round to 2 decimal places
        const estimatedCostFormatted = event.estimated_cost
            ? `£${(Math.round(event.estimated_cost) / 100).toFixed(2)}`
            : 'N/A';

        // Generate HTML for the event details with a textarea for the comment
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Charging Event Details</title>
            <link href="/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet">
        </head>
        <body>
            <div class="container mt-4">
                <h1>Charging Event Details</h1>
                <table class="table table-bordered">
                    <tr>
                        <th>ID</th>
                        <td>${event.id}</td>
                    </tr>
                    <tr>
                        <th>Start Time</th>
                        <td>${new Date(event.start_time).toLocaleString()}</td>
                    </tr>
                    <tr>
                        <th>End Time</th>
                        <td>${event.end_time ? new Date(event.end_time).toLocaleString() : 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Energy Used (kWh)</th>
                        <td>${event.energy_used ? parseFloat(event.energy_used).toFixed(3) : 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Estimated Cost (£)</th>
                        <td>${estimatedCostFormatted}</td>
                    </tr>
                    <tr>
                        <th>Settled</th>
                        <td>${event.settled ? 'Yes' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Percent Charged (%)</th>
                        <td>${event.percent_charged || 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Ignore Event</th>
                        <td>${event.ignore_event ? 'Yes' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Comment</th>
                        <td>
                            <textarea id="comment" class="form-control" rows="4">${event.comment || ''}</textarea>
                            <button id="saveComment" class="btn btn-primary mt-3">Save Comment</button>
                        </td>
                    </tr>
                </table>
                <a href="/view_charging_events" class="btn btn-secondary mt-3">Back to All Charging Events</a>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
            <script>
                // Pass event ID as a global variable to the script
                const eventId = ${event.id};  // Injecting the event ID into the script

                document.getElementById('saveComment').addEventListener('click', async function() {
                    const comment = document.getElementById('comment').value;
                    try {
                        const response = await fetch('/update_table', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ id: eventId, comment: comment })
                        });

                        if (response.ok) {
                            alert('Comment updated successfully!');
                            window.location.reload();  // Reload to reflect changes
                        } else {
                            const error = await response.text();  // Get error response body
                            alert(\`Failed to update comment: \${error}\`);
                        }
                    } catch (error) {
                        console.error('Error sending request:', error);
                        alert('Error sending request to server');
                    }
                });
            </script>
        </body>
        </html>`;

        res.send(html);
    } catch (error) {
        console.error('Error fetching charging event details:', error);
        res.status(500).send('Error fetching charging event details');
    } finally {
        await client.end();
    }
});



// Endpoint to update the comment in the charging_events table
app.post('/update_table', async (req, res) => {
    const { id, comment } = req.body;
    const client = new Client(dbConfig);

    console.log(req.body);

    try {
        await client.connect();

        // Update the comment for the specific charging event
        const result = await client.query(`
            UPDATE charging_events
            SET comment = $1
            WHERE id = $2
            RETURNING id, comment;
        `, [comment, id]);

        if (result.rowCount === 0) {
            return res.status(404).send('Charging event not found');
        }

        console.log(`Updated comment for event ID ${id}: ${result.rows[0].comment}`);
        res.status(200).send('Comment updated successfully');
    } catch (error) {
        console.error('Error updating comment:', error);
        res.status(500).send('Error updating comment');
    } finally {
        await client.end();
    }
});



app.get('/view_charge_event_error/:id_number', async (req, res) => {
    const { id_number } = req.params;
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Query the specific charging event by ID
        const result = await client.query(`
            SELECT id, start_time, end_time, energy_used, estimated_cost, settled, percent_charged, ignore_event
            FROM charging_events 
            WHERE id = $1
        `, [id_number]);

        if (result.rows.length === 0) {
            res.status(404).send('Charging event not found.');
            return;
        }

        const event = result.rows[0];

        // Format estimated_cost from pence to pounds and round to 2 decimal places
        const estimatedCostFormatted = event.estimated_cost
            ? `£${(Math.round(event.estimated_cost) / 100).toFixed(2)}`
            : 'N/A';

        // Generate HTML for the error page
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error: Charging Event</title>
            <link href="/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet">
        </head>
        <body>
            <div class="container mt-4">
                <h1 class="text-danger">Error Processing Charging Event</h1>
                <p class="text-warning">There was an issue processing this charging event. Please review the details below and try again or contact support.</p>
                
                <table class="table table-bordered">
                    <tr>
                        <th>ID</th>
                        <td>${event.id}</td>
                    </tr>
                    <tr>
                        <th>Start Time</th>
                        <td>${new Date(event.start_time).toLocaleString()}</td>
                    </tr>
                    <tr>
                        <th>End Time</th>
                        <td>${event.end_time ? new Date(event.end_time).toLocaleString() : 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Energy Used (kWh)</th>
                        <td>${event.energy_used ? parseFloat(event.energy_used).toFixed(3) : 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Estimated Cost (£)</th>
                        <td>${estimatedCostFormatted}</td>
                    </tr>
                    <tr>
                        <th>Settled</th>
                        <td>${event.settled ? 'Yes' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Percent Charged (%)</th>
                        <td>${event.percent_charged || 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Ignore Event</th>
                        <td>${event.ignore_event ? 'Yes' : 'No'}</td>
                    </tr>
                </table>
                
                <a href="/view_charging_events" class="btn btn-secondary mt-3">Back to All Charging Events</a>
            </div>
        </body>
        </html>`;

        res.send(html);
    } catch (error) {
        console.error('Error fetching charging event details:', error);
        res.status(500).send('Error fetching charging event details');
    } finally {
        await client.end();
    }
});

//PICO Server
// Endpoint to serve energy data for the Pico
app.get('/pico_display', async (req, res) => {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Step 1: Find the most recent full 24-hour period (the most recent date with a full day of data)
        const latestDateQuery = `
            SELECT DATE(start_time) AS data_date
            FROM electric_consumption
            GROUP BY data_date
            ORDER BY data_date DESC
            LIMIT 1;
        `;
        const latestDateResult = await client.query(latestDateQuery);

        if (latestDateResult.rowCount === 0) {
            return res.status(404).send('No data available in electric_consumption table.');
        }

        const latestDate = latestDateResult.rows[0].data_date; // Most recent date with full 24h data

        // Step 2: Calculate the 8-day range (1 extra day for context + 7 full days)
        const startDate = new Date(latestDate);
        startDate.setDate(startDate.getDate() - 7); // Go back 7 full days before the latest date

        const startDateString = startDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
        const endDateString = latestDate; // Up to the most recent full day

        // Step 3: Fetch electric consumption data for the last 8 days
        const electricQuery = `
            SELECT DATE(start_time) AS date, SUM(consumption_kwh) AS electric_usage
            FROM electric_consumption
            WHERE start_time::date BETWEEN $1 AND $2
            GROUP BY date
            ORDER BY date;
        `;
        const electricResult = await client.query(electricQuery, [startDateString, endDateString]);

        // Log the raw electric data to debug
        console.log("Electric Data Raw Result:", electricResult.rows);

        // Step 4: Fetch gas consumption data for the last 8 days
        const gasQuery = `
            SELECT DATE(start_time) AS date, SUM(consumption_kwh) AS gas_usage
            FROM gas_consumption
            WHERE start_time::date BETWEEN $1 AND $2
            GROUP BY date
            ORDER BY date;
        `;
        const gasResult = await client.query(gasQuery, [startDateString, endDateString]);

        // Log the raw gas data to debug
        console.log("Gas Data Raw Result:", gasResult.rows);

        // Step 5: Map and merge the data into the expected format for the Pico
        // Ensure that the date format is consistent by stripping out the time component from the raw data
        const electricDataMap = new Map(
            electricResult.rows.map(row => [row.date.toISOString().split('T')[0], row.electric_usage])
        );
        const gasDataMap = new Map(
            gasResult.rows.map(row => [row.date.toISOString().split('T')[0], row.gas_usage])
        );

        const sample_energy_data = [];
        for (let i = 0; i <= 7; i++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + i);
            const dateString = currentDate.toISOString().split('T')[0];

            // Log dateString to check if the correct date is being used
            console.log("Processing data for date:", dateString);

            sample_energy_data.push({
                date: dateString,
                electric_usage: electricDataMap.get(dateString) || "0.0",
                gas_usage: gasDataMap.get(dateString) || "0.0"
            });
        }

        const energy_data = {
            "output": sample_energy_data
        };

        // Send the energy data as a JSON response
        res.json(energy_data);

    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    } finally {
        await client.end();
    }
});

app.get('/pico_summary', async (req, res) => {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Print the date range we're querying to ensure the period is correct
        const today = new Date();
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 9); // Offset by 2 days
        console.log(`Fetching data for the last 7 days: from ${sevenDaysAgo.toISOString()} to ${today.toISOString()}`);

        // Step 1: Calculate the 7-Day Cost (last 7 days) for Gas
        const sevenDayGasCostQuery = `
            SELECT 
                DATE(start_time) AS date,
                SUM(price_pence) AS gas_cost
            FROM gas_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '9 DAY'  -- Offset by 2 days
            GROUP BY DATE(start_time)
            ORDER BY DATE(start_time) DESC;
        `;
        const sevenDayGasCostResult = await client.query(sevenDayGasCostQuery);

        if (sevenDayGasCostResult.rowCount === 0) {
            console.log('No gas data available for the last 7 days.');
            return res.status(404).send('No gas data available for the last 7 days.');
        }

        // Debug: log the raw gas cost data for the last 7 days
        console.log("Seven Day Gas Cost Data:", sevenDayGasCostResult.rows);

        // Step 2: Calculate the 7-Day Cost for Electric
        const sevenDayElectricCostQuery = `
            SELECT 
                DATE(start_time) AS date,
                SUM(price_pence) AS electric_cost
            FROM electric_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '9 DAY'  -- Offset by 2 days
            GROUP BY DATE(start_time)
            ORDER BY DATE(start_time) DESC;
        `;
        const sevenDayElectricCostResult = await client.query(sevenDayElectricCostQuery);

        if (sevenDayElectricCostResult.rowCount === 0) {
            console.log('No electric data available for the last 7 days.');
            return res.status(404).send('No electric data available for the last 7 days.');
        }

        // Debug: log the raw electric cost data for the last 7 days
        console.log("Seven Day Electric Cost Data:", sevenDayElectricCostResult.rows);

        // Step 3: Merge Gas and Electric Data for the Last 7 Days
        const sevenDayGasData = new Map(sevenDayGasCostResult.rows.map(row => [row.date.toISOString().split('T')[0], row.gas_cost]));
        const sevenDayElectricData = new Map(sevenDayElectricCostResult.rows.map(row => [row.date.toISOString().split('T')[0], row.electric_cost]));

        let totalSevenDayCost = 0;

        // Add both gas and electric costs for each day
        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() - (i + 2));  // Offset each day by 2 days
            const dateString = date.toISOString().split('T')[0]; // Get date in YYYY-MM-DD format

            const gasCost = (sevenDayGasData.get(dateString) || 0) / 100; // Convert pence to pounds
            const electricCost = (sevenDayElectricData.get(dateString) || 0) / 100; // Convert pence to pounds
            totalSevenDayCost += gasCost + electricCost;
        }

        // Debug: Print the total cost for the last 7 days
        console.log(`Total 7-Day Cost: £${totalSevenDayCost.toFixed(2)}`);

        // Step 4: Calculate the current month's cost (from the 1st of the current month to today) for Gas
        const currentMonthGasCostQuery = `
            SELECT 
                SUM(price_pence) AS gas_cost
            FROM gas_consumption
            WHERE start_time >= DATE_TRUNC('month', CURRENT_DATE);
        `;
        const currentMonthGasCostResult = await client.query(currentMonthGasCostQuery);

        if (currentMonthGasCostResult.rowCount === 0) {
            console.log('No gas data available for the current month.');
            return res.status(404).send('No gas data available for the current month.');
        }

        const currentMonthGasCost = (currentMonthGasCostResult.rows[0].gas_cost || 0) / 100;

        // Step 5: Calculate the current month's cost for Electric
        const currentMonthElectricCostQuery = `
            SELECT 
                SUM(price_pence) AS electric_cost
            FROM electric_consumption
            WHERE start_time >= DATE_TRUNC('month', CURRENT_DATE);
        `;
        const currentMonthElectricCostResult = await client.query(currentMonthElectricCostQuery);

        if (currentMonthElectricCostResult.rowCount === 0) {
            console.log('No electric data available for the current month.');
            return res.status(404).send('No electric data available for the current month.');
        }

        const currentMonthElectricCost = (currentMonthElectricCostResult.rows[0].electric_cost || 0) / 100;

        // Step 6: Calculate the cost for the previous 7 days (for the difference calculation)
        const previousSevenDayGasCostQuery = `
            SELECT 
                SUM(price_pence) AS gas_cost
            FROM gas_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '16 DAY'
            AND start_time < CURRENT_DATE - INTERVAL '9 DAY';  -- Adjust for the previous 7 days
        `;
        const previousSevenDayGasCostResult = await client.query(previousSevenDayGasCostQuery);

        if (previousSevenDayGasCostResult.rowCount === 0) {
            console.log('No gas data available for the previous 7 days.');
            return res.status(404).send('No gas data available for the previous 7 days.');
        }

        const previousSevenDayGasCost = (previousSevenDayGasCostResult.rows[0].gas_cost || 0) / 100;

        const previousSevenDayElectricCostQuery = `
            SELECT 
                SUM(price_pence) AS electric_cost
            FROM electric_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '16 DAY'
            AND start_time < CURRENT_DATE - INTERVAL '9 DAY';  -- Adjust for the previous 7 days
        `;
        const previousSevenDayElectricCostResult = await client.query(previousSevenDayElectricCostQuery);

        if (previousSevenDayElectricCostResult.rowCount === 0) {
            console.log('No electric data available for the previous 7 days.');
            return res.status(404).send('No electric data available for the previous 7 days.');
        }

        const previousSevenDayElectricCost = (previousSevenDayElectricCostResult.rows[0].electric_cost || 0) / 100;

        // Step 7: Calculate the Difference between the current and previous 7-day costs
        const difference = (totalSevenDayCost - (previousSevenDayGasCost + previousSevenDayElectricCost)).toFixed(2);

        // Construct the summary data response
        const summaryData = {
            "7-Day Cost": totalSevenDayCost.toFixed(2),  // Format to 2 decimal places
            "Difference": difference,  // Difference is already formatted
            "This Month": (currentMonthGasCost + currentMonthElectricCost).toFixed(2) // Format to 2 decimal places
        };

        // Send the summary data as a JSON response
        res.json(summaryData);

    } catch (error) {
        console.error('Error fetching summary data:', error);
        res.status(500).send('Error fetching summary data');
    } finally {
        await client.end();
    }
});






// Start the server
app.listen(port, () => {
    console.log(`Web server running on port ${port}. Access it at http://localhost:${port}/view-electric or http://localhost:${port}/view-gas`);
});
