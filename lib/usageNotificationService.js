const { Client } = require('pg');
const { loadDbConfig } = require('./loadDbConfig');
const { sendBasicHtmlNotification } = require('./localNotifier');

const dbConfig = loadDbConfig();

function toPounds(pence) {
    return Number(pence || 0) / 100;
}

function fmtPounds(v) {
    return `£${Number(v || 0).toFixed(2)}`;
}

function fmtKwh(v) {
    return Number(v || 0).toFixed(2);
}

function dateOnly(value) {
    return new Date(value).toISOString().slice(0, 10);
}

async function getLatestCommonDataDate(client) {
    const q = await client.query(`
        SELECT
          (SELECT MAX(start_time) FROM electric_consumption) AS electric_max,
          (SELECT MAX(start_time) FROM gas_consumption) AS gas_max;
    `);

    const row = q.rows[0] || {};
    if (!row.electric_max || !row.gas_max) {
        throw new Error('No usage data found in electric_consumption and/or gas_consumption');
    }

    const latest = new Date(Math.min(new Date(row.electric_max).getTime(), new Date(row.gas_max).getTime()));
    return latest;
}

async function getDailySummary(client, table, startIso, endIso) {
    const result = await client.query(
        `SELECT DATE(start_time) AS day,
                SUM(consumption_kwh)::float AS kwh,
                SUM(price_pence)::float AS price_pence
         FROM ${table}
         WHERE start_time >= $1 AND start_time < $2
         GROUP BY DATE(start_time)
         ORDER BY DATE(start_time)`,
        [startIso, endIso]
    );

    return result.rows.map((r) => ({
        day: dateOnly(r.day),
        kwh: Number(r.kwh || 0),
        pricePence: Number(r.price_pence || 0)
    }));
}

function sumRows(rows) {
    return rows.reduce((acc, row) => {
        acc.kwh += Number(row.kwh || 0);
        acc.pricePence += Number(row.pricePence || 0);
        return acc;
    }, { kwh: 0, pricePence: 0 });
}

function mergeFuelDays(electricRows, gasRows) {
    const days = new Map();

    for (const row of electricRows) {
        if (!days.has(row.day)) days.set(row.day, { day: row.day, electricKwh: 0, gasKwh: 0 });
        days.get(row.day).electricKwh = row.kwh;
    }

    for (const row of gasRows) {
        if (!days.has(row.day)) days.set(row.day, { day: row.day, electricKwh: 0, gasKwh: 0 });
        days.get(row.day).gasKwh = row.kwh;
    }

    return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function buildLast7DaysHtml(payload) {
    const rows = payload.dailyRows.map((row) => `
        <tr>
          <td>${row.day}</td>
          <td>${fmtKwh(row.electricKwh)}</td>
          <td>${fmtKwh(row.gasKwh)}</td>
        </tr>
    `).join('');

    return `
    <div>
      <h3>Last 7 Days Energy Summary</h3>
      <p>Data window: ${payload.startDate} to ${payload.endDate} (latest imported day)</p>
      <p>
        Electric: <strong>${fmtKwh(payload.electric.kwh)} kWh</strong> (${fmtPounds(toPounds(payload.electric.pricePence))})<br/>
        Gas: <strong>${fmtKwh(payload.gas.kwh)} kWh</strong> (${fmtPounds(toPounds(payload.gas.pricePence))})
      </p>
      <p>
        Week vs previous week: <strong>${payload.moreExpensive ? 'More expensive' : 'Cheaper or equal'}</strong>
        (${fmtPounds(Math.abs(payload.currentWeekCost - payload.previousWeekCost))} difference)
      </p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%;">
        <thead><tr><th>Day</th><th>Electric (kWh)</th><th>Gas (kWh)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    `;
}

async function sendLast7DaysUsageNotification() {
    const client = new Client(dbConfig);

    try {
        await client.connect();
        const latest = await getLatestCommonDataDate(client);
        const end = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate() + 1));
        const start = new Date(end.getTime() - (7 * 24 * 60 * 60 * 1000));
        const prevStart = new Date(start.getTime() - (7 * 24 * 60 * 60 * 1000));

        const [electricDaily, gasDaily, electricPrev, gasPrev] = await Promise.all([
            getDailySummary(client, 'electric_consumption', start.toISOString(), end.toISOString()),
            getDailySummary(client, 'gas_consumption', start.toISOString(), end.toISOString()),
            getDailySummary(client, 'electric_consumption', prevStart.toISOString(), start.toISOString()),
            getDailySummary(client, 'gas_consumption', prevStart.toISOString(), start.toISOString())
        ]);

        const electric = sumRows(electricDaily);
        const gas = sumRows(gasDaily);
        const prevElectric = sumRows(electricPrev);
        const prevGas = sumRows(gasPrev);

        const currentWeekCost = toPounds(electric.pricePence + gas.pricePence);
        const previousWeekCost = toPounds(prevElectric.pricePence + prevGas.pricePence);

        const payload = {
            startDate: start.toISOString().slice(0, 10),
            endDate: new Date(end.getTime() - 1).toISOString().slice(0, 10),
            electric,
            gas,
            currentWeekCost,
            previousWeekCost,
            moreExpensive: currentWeekCost > previousWeekCost,
            dailyRows: mergeFuelDays(electricDaily, gasDaily)
        };

        return sendBasicHtmlNotification({
            title: 'Weekly Energy Usage Summary',
            body: `Electric ${fmtKwh(electric.kwh)} kWh (${fmtPounds(toPounds(electric.pricePence))}), Gas ${fmtKwh(gas.kwh)} kWh (${fmtPounds(toPounds(gas.pricePence))})`,
            html: buildLast7DaysHtml(payload)
        });
    } finally {
        await client.end();
    }
}


function buildLast3DaysHtml(payload) {
    const rows = payload.dailyRows.map((row) => `
        <tr>
          <td>${row.day}</td>
          <td>${fmtKwh(row.electricKwh)}</td>
          <td>${fmtPounds(row.electricCost)}</td>
          <td>${fmtKwh(row.gasKwh)}</td>
          <td>${fmtPounds(row.gasCost)}</td>
        </tr>
    `).join('');

    return `
    <div>
      <h3>Latest Import Successful</h3>
      <p>Past 3 days summary aligned to latest common imported day (${payload.endDate}).</p>
      <p>
        Electric: <strong>${fmtKwh(payload.electric.kwh)} kWh</strong> (${fmtPounds(toPounds(payload.electric.pricePence))})<br/>
        Gas: <strong>${fmtKwh(payload.gas.kwh)} kWh</strong> (${fmtPounds(toPounds(payload.gas.pricePence))})
      </p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%;">
        <thead><tr><th>Day</th><th>Electric kWh</th><th>Electric cost</th><th>Gas kWh</th><th>Gas cost</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    `;
}

async function sendLast3DaysUsageNotification() {
    const client = new Client(dbConfig);

    try {
        await client.connect();
        const latest = await getLatestCommonDataDate(client);
        const end = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate() + 1));
        const start = new Date(end.getTime() - (3 * 24 * 60 * 60 * 1000));

        const [electricDaily, gasDaily] = await Promise.all([
            getDailySummary(client, 'electric_consumption', start.toISOString(), end.toISOString()),
            getDailySummary(client, 'gas_consumption', start.toISOString(), end.toISOString())
        ]);

        const electric = sumRows(electricDaily);
        const gas = sumRows(gasDaily);

        const byDay = new Map();
        for (const row of electricDaily) {
            byDay.set(row.day, { day: row.day, electricKwh: row.kwh, electricCost: toPounds(row.pricePence), gasKwh: 0, gasCost: 0 });
        }
        for (const row of gasDaily) {
            const existing = byDay.get(row.day) || { day: row.day, electricKwh: 0, electricCost: 0, gasKwh: 0, gasCost: 0 };
            existing.gasKwh = row.kwh;
            existing.gasCost = toPounds(row.pricePence);
            byDay.set(row.day, existing);
        }

        const payload = {
            startDate: start.toISOString().slice(0, 10),
            endDate: new Date(end.getTime() - 1).toISOString().slice(0, 10),
            electric,
            gas,
            dailyRows: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
        };

        return sendBasicHtmlNotification({
            title: 'Auto Import Complete (Last 3 Days)',
            body: `Electric ${fmtKwh(electric.kwh)} kWh (${fmtPounds(toPounds(electric.pricePence))}), Gas ${fmtKwh(gas.kwh)} kWh (${fmtPounds(toPounds(gas.pricePence))})`,
            html: buildLast3DaysHtml(payload)
        });
    } finally {
        await client.end();
    }
}

async function getTopDays(client, table, startIso, endIso, limit = 3) {
    const result = await client.query(
        `SELECT DATE(start_time) AS day,
                SUM(consumption_kwh)::float AS kwh,
                SUM(price_pence)::float AS price_pence
         FROM ${table}
         WHERE start_time >= $1 AND start_time < $2
         GROUP BY DATE(start_time)
         ORDER BY SUM(consumption_kwh) DESC
         LIMIT $3`,
        [startIso, endIso, limit]
    );

    return result.rows.map((r) => ({
        day: dateOnly(r.day),
        kwh: Number(r.kwh || 0),
        cost: toPounds(r.price_pence)
    }));
}

function buildTopDaysList(rows) {
    if (rows.length === 0) return '<li>No data</li>';
    return rows.map((row) => `<li>${row.day}: ${fmtKwh(row.kwh)} kWh (${fmtPounds(row.cost)})</li>`).join('');
}

function monthStartUtc(year, month) {
    return new Date(Date.UTC(year, month, 1, 0, 0, 0));
}

async function monthTotals(client, table, startIso, endIso) {
    const result = await client.query(
        `SELECT COALESCE(SUM(consumption_kwh), 0)::float AS kwh,
                COALESCE(SUM(price_pence), 0)::float AS price_pence
         FROM ${table}
         WHERE start_time >= $1 AND start_time < $2`,
        [startIso, endIso]
    );

    return {
        kwh: Number(result.rows[0].kwh || 0),
        pricePence: Number(result.rows[0].price_pence || 0)
    };
}

function signed(value, digits = 2) {
    const n = Number(value || 0);
    const str = Math.abs(n).toFixed(digits);
    return `${n >= 0 ? '+' : '-'}${str}`;
}

async function sendLastMonthUsageNotification() {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        const now = new Date();
        const thisMonthStart = monthStartUtc(now.getUTCFullYear(), now.getUTCMonth());
        const lastMonthStart = monthStartUtc(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() - 1);
        const prevMonthStart = monthStartUtc(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() - 2);

        const [
            electricTotals,
            gasTotals,
            prevElectricTotals,
            prevGasTotals,
            topElectric,
            topGas
        ] = await Promise.all([
            monthTotals(client, 'electric_consumption', lastMonthStart.toISOString(), thisMonthStart.toISOString()),
            monthTotals(client, 'gas_consumption', lastMonthStart.toISOString(), thisMonthStart.toISOString()),
            monthTotals(client, 'electric_consumption', prevMonthStart.toISOString(), lastMonthStart.toISOString()),
            monthTotals(client, 'gas_consumption', prevMonthStart.toISOString(), lastMonthStart.toISOString()),
            getTopDays(client, 'electric_consumption', lastMonthStart.toISOString(), thisMonthStart.toISOString(), 3),
            getTopDays(client, 'gas_consumption', lastMonthStart.toISOString(), thisMonthStart.toISOString(), 3)
        ]);

        const gasDeltaKwh = gasTotals.kwh - prevGasTotals.kwh;
        const gasDeltaCost = toPounds(gasTotals.pricePence - prevGasTotals.pricePence);
        const electricDeltaKwh = electricTotals.kwh - prevElectricTotals.kwh;
        const electricDeltaCost = toPounds(electricTotals.pricePence - prevElectricTotals.pricePence);

        const html = `
          <div>
            <h3>Last Calendar Month Energy Summary</h3>
            <p>Period: ${lastMonthStart.toISOString().slice(0, 10)} to ${(new Date(thisMonthStart.getTime() - 1)).toISOString().slice(0, 10)}</p>
            <p>
              Gas total: <strong>${fmtKwh(gasTotals.kwh)} kWh</strong> (${fmtPounds(toPounds(gasTotals.pricePence))})<br/>
              Electric total: <strong>${fmtKwh(electricTotals.kwh)} kWh</strong> (${fmtPounds(toPounds(electricTotals.pricePence))})
            </p>
            <p>
              Vs previous month: You used ${signed(gasDeltaKwh)} kWh gas costing ${signed(gasDeltaCost)} and ${signed(electricDeltaKwh)} kWh electric costing ${signed(electricDeltaCost)}.
            </p>
            <h4>Top 3 Gas Days</h4>
            <ol>${buildTopDaysList(topGas)}</ol>
            <h4>Top 3 Electric Days</h4>
            <ol>${buildTopDaysList(topElectric)}</ol>
          </div>
        `;

        return sendBasicHtmlNotification({
            title: 'Last Month Energy Usage Summary',
            body: `Gas ${fmtKwh(gasTotals.kwh)} kWh (${fmtPounds(toPounds(gasTotals.pricePence))}), Electric ${fmtKwh(electricTotals.kwh)} kWh (${fmtPounds(toPounds(electricTotals.pricePence))})`,
            html
        });
    } finally {
        await client.end();
    }
}

module.exports = {
    sendLast7DaysUsageNotification,
    sendLast3DaysUsageNotification,
    sendLastMonthUsageNotification
};
