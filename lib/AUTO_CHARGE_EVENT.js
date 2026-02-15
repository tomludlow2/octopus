const { autoIdentifyChargeEvent } = require('./autoIdentifyChargeEvent');
const Table = require('cli-table3');
const { loadOptionalModule } = require('./loadOptionalModule');

const generateChargingEventNotification = loadOptionalModule([
    process.env.CHARGING_EVENT_NOTIFY_MODULE,
    '/var/www/notify/templates/charging_event_generate_notification'
]);

async function runLastPeriod() {
    const endDate = new Date();
    endDate.setHours(10, 0, 0, 0);

    const startDate = new Date(endDate);
    startDate.setHours(startDate.getHours() - 72);

    console.log(
        `Running auto-identify process from ${startDate.toISOString()} to ${endDate.toISOString()}`
    );

    try {
        const results = await autoIdentifyChargeEvent(startDate, endDate);

        console.log('Process completed successfully.');
        if (results.data.chargingEvents && results.data.chargingEvents.length > 0) {
            displayChargingEvents(results.data.chargingEvents);

            if (generateChargingEventNotification) {
                await generateChargingEventNotification(results);
            } else {
                console.warn('Charging event notification module not found. Skipping notification generation.');
            }
        } else {
            console.log('No charging events detected.');
        }
    } catch (error) {
        console.error('Error running auto-identify process:', error);
    }
}

function displayChargingEvents(chargingEvents) {
    const table = new Table({
        head: ['Event #', 'Start Time', 'Start State (%)', 'End Time', 'End State (%)'],
        colWidths: [10, 25, 20, 25, 20]
    });

    chargingEvents.forEach((event, index) => {
        table.push([
            index + 1,
            event.start_time.toISOString(),
            event.start_state,
            event.end_time ? event.end_time.toISOString() : 'Ongoing',
            event.end_state || 'Ongoing'
        ]);
    });

    console.log(table.toString());
}

runLastPeriod();
