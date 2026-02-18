const assert = require('assert');
const { sendBasicHtmlNotification } = require('../../lib/localNotifier');

async function run() {
    const result = await sendBasicHtmlNotification({
        title: 'Basic Notification Test',
        body: 'Testing html notification delivery',
        html: '<div><h3>Basic Notification Test</h3><p>Live endpoint notification test</p></div>'
    });

    assert.ok(result.status >= 200 && result.status < 300, `Expected 2xx status, got ${result.status}`);

    console.log('ok - basic html notification sent to live endpoint');
    console.log(JSON.stringify({
        endpoint: result.endpoint,
        status: result.status,
        response: result.data
    }, null, 2));
}

run().catch((error) => {
    console.error('basic notification test failed:', error.message || String(error));
    if (error.response) {
        console.error('response status:', error.response.status);
        console.error('response data:', JSON.stringify(error.response.data));
    }
    process.exitCode = 1;
});
