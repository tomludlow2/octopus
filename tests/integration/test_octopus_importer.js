const assert = require('assert');
const { upsertUsageRows, buildRateMap } = require('../../lib/octopusImporter');

class MockClient {
    constructor() {
        this.rows = new Map();
    }

    async query(sql, params = []) {
        if (sql.includes('INSERT INTO electric_consumption')) {
            const key = String(params[2]);
            const exists = this.rows.has(key);
            this.rows.set(key, {
                consumption_kwh: params[0],
                price_pence: params[1],
                start_time: params[2],
                end_time: params[3]
            });
            return { rows: [{ inserted: !exists }], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
    }
}

async function run() {
    const client = new MockClient();
    const usageRows = [{
        interval_start: '2026-02-15T10:00:00.000Z',
        interval_end: '2026-02-15T10:30:00.000Z',
        consumption: 1.5
    }];

    const ratesA = [{
        valid_from: '2026-02-15T10:00:00.000Z',
        valid_to: '2026-02-15T10:30:00.000Z',
        value_inc_vat: 10,
        value_exc_vat: 9
    }];

    const ratesB = [{
        valid_from: '2026-02-15T10:00:00.000Z',
        valid_to: '2026-02-15T10:30:00.000Z',
        value_inc_vat: 12,
        value_exc_vat: 11
    }];

    const first = await upsertUsageRows(client, 'electric', usageRows, buildRateMap(ratesA));
    const second = await upsertUsageRows(client, 'electric', usageRows, buildRateMap(ratesA));

    assert.strictEqual(first.inserted, 1, 'first run inserts row');
    assert.strictEqual(second.inserted, 0, 'second run should not duplicate row');
    assert.strictEqual(client.rows.size, 1, 'still one row in table');

    const beforePrice = client.rows.get('2026-02-15T10:00:00.000Z').price_pence;
    const third = await upsertUsageRows(client, 'electric', usageRows, buildRateMap(ratesB));
    const afterPrice = client.rows.get('2026-02-15T10:00:00.000Z').price_pence;

    assert.strictEqual(third.updated, 1, 'rate refresh should update existing row');
    assert.notStrictEqual(beforePrice, afterPrice, 'price should change when rates change');

    console.log('ok - importer upsert idempotency + retrospective reprice update');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
