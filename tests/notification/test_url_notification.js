const assert = require('assert');
const { sendUrlNotification } = require('../../lib/localNotifier');

async function run() {
    const result = await sendUrlNotification({
        title: 'URL Notification Test',
        body: 'Testing url notification delivery',
        url: 'http://localhost:52529/view-electric?range=month&date=2026-02-01'
    });

    assert.ok(result.status >= 200 && result.status < 300, `Expected 2xx status, got ${result.status}`);

    console.log('ok - url notification sent to live endpoint');
    console.log(JSON.stringify({
        endpoint: result.endpoint,
        status: result.status,
        response: result.data
    }, null, 2));
}

run().catch((error) => {
    console.error('url notification test failed:', error.message || String(error));
    if (error.response) {
        console.error('response status:', error.response.status);
        console.error('response data:', JSON.stringify(error.response.data));
    }
    process.exitCode = 1;
});
