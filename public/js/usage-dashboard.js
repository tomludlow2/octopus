(() => {
    const root = document.getElementById('usage-dashboard-root');
    if (!root) return;

    const fuel = root.dataset.fuel;
    const els = {
        viewButtons: Array.from(document.querySelectorAll('#viewModeGroup button')),
        metricButtons: Array.from(document.querySelectorAll('#metricGroup button')),
        dateInput: document.getElementById('dateInput'),
        prevBtn: document.getElementById('prevBtn'),
        nextBtn: document.getElementById('nextBtn'),
        todayBtn: document.getElementById('todayBtn'),
        includeTypical: document.getElementById('includeTypical'),
        includeLast: document.getElementById('includeLast'),
        exportButtons: Array.from(document.querySelectorAll('[data-export]')),
        loading: document.getElementById('loadingState'),
        error: document.getElementById('dashboardError'),
        sumKwh: document.getElementById('sumKwh'),
        sumCost: document.getElementById('sumCost'),
        sumDelta: document.getElementById('sumDelta'),
        chart: document.getElementById('usageChart'),
        tbody: document.querySelector('#usageTable tbody'),
        totKwh: document.getElementById('totKwh'),
        totCost: document.getElementById('totCost'),
        totTypicalKwh: document.getElementById('totTypicalKwh'),
        totTypicalCost: document.getElementById('totTypicalCost'),
        totLastKwh: document.getElementById('totLastKwh'),
        totLastCost: document.getElementById('totLastCost')
    };

    const state = {
        view: 'day',
        metric: 'kwh',
        date: new Date().toISOString().slice(0, 10),
        includeTypical: false,
        includeLast: false,
        payload: null,
        sortKey: 'bucket_start',
        sortDirection: 'asc'
    };

    let chart;

    function formatNum(value, digits = 3) {
        return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }

    function formatCurrency(value) {
        return Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'GBP' });
    }

    function toMonth(dateStr) {
        return dateStr.slice(0, 7);
    }

    function setLoading(on) {
        els.loading.classList.toggle('d-none', !on);
    }

    function setError(message) {
        if (message) {
            els.error.textContent = message;
            els.error.classList.remove('d-none');
        } else {
            els.error.classList.add('d-none');
            els.error.textContent = '';
        }
    }

    function updateButtons() {
        els.viewButtons.forEach((btn) => {
            const active = btn.dataset.view === state.view;
            btn.classList.toggle('btn-primary', active);
            btn.classList.toggle('btn-outline-primary', !active);
        });
        els.metricButtons.forEach((btn) => {
            const active = btn.dataset.metric === state.metric;
            btn.classList.toggle('btn-primary', active);
            btn.classList.toggle('btn-outline-primary', !active);
        });
        els.dateInput.type = state.view === 'month' ? 'month' : 'date';
        els.dateInput.value = state.view === 'month' ? toMonth(state.date) : state.date;
    }

    function buildQuery() {
        const query = new URLSearchParams();
        query.set('view', state.view);
        query.set('date', state.date);
        query.set('month', toMonth(state.date));
        if (state.includeTypical) query.set('includeTypical', '1');
        if (state.includeLast) query.set('includeLast', '1');
        return query;
    }

    async function loadData() {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/usage/${fuel}?${buildQuery().toString()}`);
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            state.payload = await res.json();
            render();
        } catch (error) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    }

    function currentRows() {
        if (!state.payload?.rows) return [];
        const rows = [...state.payload.rows];
        rows.sort((a, b) => {
            const av = a[state.sortKey] ?? '';
            const bv = b[state.sortKey] ?? '';
            const cmp = typeof av === 'number' || typeof bv === 'number'
                ? Number(av || 0) - Number(bv || 0)
                : String(av).localeCompare(String(bv));
            return state.sortDirection === 'asc' ? cmp : -cmp;
        });
        return rows;
    }

    function bucketLabel(row) {
        const start = new Date(row.bucket_start);
        if (state.view === 'day') return start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return start.toLocaleDateString();
    }

    function renderSummary() {
        const totals = state.payload.totals;
        els.sumKwh.textContent = `${formatNum(totals.kwh, 3)} kWh`;
        els.sumCost.textContent = formatCurrency(totals.cost_gbp);

        if (state.includeTypical && totals.typical_kwh !== null) {
            const delta = totals.kwh - totals.typical_kwh;
            const pct = totals.typical_kwh ? (delta / totals.typical_kwh) * 100 : 0;
            els.sumDelta.textContent = `vs Typical: ${formatNum(delta, 3)} kWh (${pct.toFixed(1)}%)`;
            return;
        }

        if (state.includeLast && totals.last_period_kwh !== null) {
            const delta = totals.kwh - totals.last_period_kwh;
            const pct = totals.last_period_kwh ? (delta / totals.last_period_kwh) * 100 : 0;
            els.sumDelta.textContent = `vs Last: ${formatNum(delta, 3)} kWh (${pct.toFixed(1)}%)`;
            return;
        }

        els.sumDelta.textContent = 'Enable Typical/Last Period';
    }

    function renderChart() {
        if (!state.payload) return;
        const rows = state.payload.rows;
        const labels = rows.map(bucketLabel);
        const valueField = state.metric === 'kwh' ? 'kwh' : 'cost_gbp';
        const typicalField = state.metric === 'kwh' ? 'typical_kwh' : 'typical_cost_gbp';
        const lastField = state.metric === 'kwh' ? 'last_period_kwh' : 'last_period_cost_gbp';

        const datasets = [
            {
                label: state.metric === 'kwh' ? 'Actual kWh' : 'Actual £',
                data: rows.map((r) => Number(r[valueField] || 0)),
                backgroundColor: 'rgba(25, 118, 210, 0.35)',
                borderColor: '#1976d2',
                borderWidth: 1,
                type: 'bar'
            }
        ];

        if (state.includeTypical) {
            datasets.push({
                label: state.metric === 'kwh' ? 'Typical kWh' : 'Typical £',
                data: rows.map((r) => Number(r[typicalField] || 0)),
                borderColor: '#6a1b9a',
                backgroundColor: 'transparent',
                borderWidth: 2,
                type: 'line'
            });
        }
        if (state.includeLast) {
            datasets.push({
                label: state.metric === 'kwh' ? 'Last Period kWh' : 'Last Period £',
                data: rows.map((r) => Number(r[lastField] || 0)),
                borderColor: '#2e7d32',
                backgroundColor: 'transparent',
                borderWidth: 2,
                type: 'line'
            });
        }

        if (chart) chart.destroy();
        chart = new Chart(els.chart, {
            data: { labels, datasets },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    function renderTable() {
        const rows = currentRows();
        els.tbody.innerHTML = rows.map((row) => `
            <tr>
                <td>${new Date(row.bucket_start).toLocaleString()}</td>
                <td>${new Date(row.bucket_end).toLocaleString()}</td>
                <td>${formatNum(row.kwh, 3)}</td>
                <td>${formatCurrency(row.cost_gbp)}</td>
                <td>${row.typical_kwh === null ? '-' : formatNum(row.typical_kwh, 3)}</td>
                <td>${row.typical_cost_gbp === null ? '-' : formatCurrency(row.typical_cost_gbp)}</td>
                <td>${row.last_period_kwh === null ? '-' : formatNum(row.last_period_kwh, 3)}</td>
                <td>${row.last_period_cost_gbp === null ? '-' : formatCurrency(row.last_period_cost_gbp)}</td>
            </tr>
        `).join('');

        const totals = state.payload.totals;
        els.totKwh.textContent = formatNum(totals.kwh, 3);
        els.totCost.textContent = formatCurrency(totals.cost_gbp);
        els.totTypicalKwh.textContent = totals.typical_kwh === null ? '-' : formatNum(totals.typical_kwh, 3);
        els.totTypicalCost.textContent = totals.typical_cost_gbp === null ? '-' : formatCurrency(totals.typical_cost_gbp);
        els.totLastKwh.textContent = totals.last_period_kwh === null ? '-' : formatNum(totals.last_period_kwh, 3);
        els.totLastCost.textContent = totals.last_period_cost_gbp === null ? '-' : formatCurrency(totals.last_period_cost_gbp);
    }

    function render() {
        if (!state.payload) return;
        renderSummary();
        renderChart();
        renderTable();
    }

    function shiftDate(direction) {
        const d = new Date(`${state.date}T00:00:00`);
        if (state.view === 'day') d.setDate(d.getDate() + direction);
        if (state.view === 'week') d.setDate(d.getDate() + 7 * direction);
        if (state.view === 'month') d.setMonth(d.getMonth() + direction);
        state.date = d.toISOString().slice(0, 10);
    }

    function setupEvents() {
        els.viewButtons.forEach((btn) => btn.addEventListener('click', () => {
            state.view = btn.dataset.view;
            updateButtons();
            loadData();
        }));

        els.metricButtons.forEach((btn) => btn.addEventListener('click', () => {
            state.metric = btn.dataset.metric;
            updateButtons();
            render();
        }));

        els.dateInput.addEventListener('change', () => {
            const value = els.dateInput.value;
            state.date = state.view === 'month' ? `${value}-01` : value;
            loadData();
        });

        els.prevBtn.addEventListener('click', () => { shiftDate(-1); updateButtons(); loadData(); });
        els.nextBtn.addEventListener('click', () => { shiftDate(1); updateButtons(); loadData(); });
        els.todayBtn.addEventListener('click', () => {
            state.date = new Date().toISOString().slice(0, 10);
            updateButtons();
            loadData();
        });

        els.includeTypical.addEventListener('change', () => { state.includeTypical = els.includeTypical.checked; loadData(); });
        els.includeLast.addEventListener('change', () => { state.includeLast = els.includeLast.checked; loadData(); });

        els.exportButtons.forEach((btn) => btn.addEventListener('click', () => {
            const query = buildQuery();
            query.set('format', btn.dataset.export);
            window.location.href = `/api/usage/${fuel}/export?${query.toString()}`;
        }));

        document.querySelectorAll('#usageTable thead th[data-sort]').forEach((th) => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                if (state.sortKey === key) {
                    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sortKey = key;
                    state.sortDirection = 'asc';
                }
                renderTable();
            });
        });
    }

    setupEvents();
    updateButtons();
    loadData();
})();
