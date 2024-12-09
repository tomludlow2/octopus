const { autoIdentifyChargeEvent } = require('./autoIdentifyChargeEvent');
const Table = require('cli-table3'); // Import cli-table3 for table formatting
const generateChargingEventNotification = require('/var/www/notify/templates/charging_event_generate_notification');

async function runLastPeriod() {
    // Define the current end date as 10am today
    const endDate = new Date();
    endDate.setHours(10, 0, 0, 0);

    // Define the start date as 72 hours (3 days) before the end date
    const startDate = new Date(endDate);
    startDate.setHours(startDate.getHours() - 72);

    console.log(
        `Running auto-fetch process for data from ${startDate.toISOString()} to ${endDate.toISOString()}`
    );

    try {
        const results = await autoIdentifyChargeEvent(startDate, endDate);

        console.log('Process completed successfully.');
        if (results.data.chargingEvents && results.data.chargingEvents.length > 0) {
            displayChargingEvents(results.data.chargingEvents);
            await generateChargingEventNotification(results);
        } else {
            console.log('No charging events detected.');
        }
    } catch (error) {
        console.error('Error running auto-fetch process:', error);
    }
}

// Function to display charging events in a CLI table
function displayChargingEvents(chargingEvents) {
    const table = new Table({
        head: ['Event #', 'Start Time', 'Start State (%)', 'End Time', 'End State (%)'],
        colWidths: [10, 25, 20, 25, 20],
    });

    chargingEvents.forEach((event, index) => {
        table.push([
            index + 1,
            event.start_time.toISOString(),
            event.start_state,
            event.end_time ? event.end_time.toISOString() : 'Ongoing',
            event.end_state || 'Ongoing',
        ]);
    });

    console.log(table.toString());
}

// Execute the function
runLastPeriod();
