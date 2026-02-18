const http = require('http');
const assert = require('assert');
const { sendUrlNotification } = require('../../lib/localNotifier');

async function createTestServer() {
    return new Promise((resolve) => {
        const requests = [];
        const server = http.createServer((req, res) => {
            if (req.method !== 'POST' || req.url !== '/api/notify') {
                res.statusCode = 404;
                res.end('not found');
                return;
            }

            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                requests.push(JSON.parse(body));
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
            });
        });

        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, port, requests });
        });
    });
}

async function run() {
    const { server, port, requests } = await createTestServer();

    try {
        const result = await sendUrlNotification({
            title: 'Open URL Notification',
            body: 'Open the detailed page',
            url: 'http://localhost:52529/view-electric?range=month&date=2026-02-01'
        }, {
            endpoint: `http://127.0.0.1:${port}/api/notify`
        });

        assert.strictEqual(result.status, 200);
        assert.strictEqual(requests.length, 1);
        assert.strictEqual(requests[0].title, 'Open URL Notification');
        assert.strictEqual(requests[0].sendNow, true);
        assert.strictEqual(requests[0].url, 'http://localhost:52529/view-electric?range=month&date=2026-02-01');
        assert.strictEqual(requests[0].html, undefined);

        console.log('ok - url notification test passed');
    } finally {
        server.close();
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
