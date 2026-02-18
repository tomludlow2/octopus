const { sendLast7DaysUsageNotification } = require('../lib/usageNotificationService');

async function run() {
    const result = await sendLast7DaysUsageNotification();
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    run().catch((error) => {
        console.error('Failed to send last-7-days usage notification:', error.message);
        process.exitCode = 1;
    });
}
