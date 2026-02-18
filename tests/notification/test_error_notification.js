const { localErrorNotify } = require('../../lib/localNotifier');

async function run() {
    const result = await localErrorNotify(
        'POSTGRES_CONNECTION_ERROR',
        'Could not connect to postgres while fetching usage summary',
        {
            url: 'http://localhost:52529/logs',
            logFile: './logs/activity-latest.log'
        }
    );

    console.log('ok - error notification sent');
    console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
    console.error('error notification test failed:', error.message || String(error));
    if (error.response) {
        console.error('response status:', error.response.status);
        console.error('response data:', JSON.stringify(error.response.data));
    }
    process.exitCode = 1;
});
