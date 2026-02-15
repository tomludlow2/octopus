const assert = require('assert');
const { upsertRateIntervals } = require('../../lib/octopusImporter');

class MockClient {
    constructor() {
        this.rateRows = new Map();
        this.auditRows = [];
    }

    async query(sql, params = []) {
        if (sql.includes('FROM octopus_rate_intervals')) {
            const rows = [];
            for (let i = 0; i < params.length; i += 3) {
                const key = `${params[i]}|${params[i + 1]}|${params[i + 2]}`;
                if (this.rateRows.has(key)) {
                    rows.push(this.rateRows.get(key));
                }
            }
            return { rows, rowCount: rows.length };
        }

        if (sql.includes('INSERT INTO octopus_rate_change_audit')) {
            this.auditRows.push(params);
            return { rowCount: 1, rows: [] };
        }

        if (sql.includes('INSERT INTO octopus_rate_intervals')) {
            const key = `${params[0]}|${params[1]}|${params[2]}`;
            const exists = this.rateRows.has(key);
            this.rateRows.set(key, {
                fuel: params[0],
                tariff_code: params[1],
                interval_start: params[2],
                value_inc_vat: params[4],
                value_exc_vat: params[5],
                source_hash: params[8],
                source_updated_at: params[7]
            });
            return { rows: [{ inserted: !exists }], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
    }
}

async function run() {
    const client = new MockClient();
    const fuel = 'electric';
    const row = {
        fuel,
        tariff_code: 'E-1R-TEST',
        interval_start: '2026-02-15T10:00:00.000Z',
        interval_end: '2026-02-15T10:30:00.000Z',
        value_inc_vat: 10.1,
        value_exc_vat: 9.5,
        payment_method: 'DIRECT_DEBIT',
        source_updated_at: '2026-02-15T00:00:00.000Z',
        source_hash: 'a'
    };

    const first = await upsertRateIntervals(client, fuel, [row], 'initial import');
    const second = await upsertRateIntervals(client, fuel, [row], 'rerun import');

    assert.strictEqual(first.inserted, 1, 'first run should insert');
    assert.strictEqual(second.inserted, 0, 'rerun should not insert duplicates');
    assert.strictEqual(client.rateRows.size, 1, 'only one row should exist after rerun');

    const changedRow = { ...row, value_inc_vat: 11.0, source_hash: 'b' };
    const third = await upsertRateIntervals(client, fuel, [changedRow], 'retrospective update');

    assert.strictEqual(third.changed, 1, 'changed interval should be detected');
    assert.strictEqual(client.auditRows.length, 1, 'change should create one audit row');

    console.log('ok - octopus importer idempotency + change detection');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
