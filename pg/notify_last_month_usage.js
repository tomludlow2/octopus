const { sendLastMonthUsageNotification } = require('../lib/usageNotificationService');

async function run() {
    const result = await sendLastMonthUsageNotification();
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    run().catch((error) => {
        console.error('Failed to send last-month usage notification:', error.message);
        process.exitCode = 1;
    });
}
