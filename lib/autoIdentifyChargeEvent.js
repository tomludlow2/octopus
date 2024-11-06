const getChargingIntervals = require('./audiDataProcessor'); // Adjust this path as needed
const { notifyChargeEventIdentified } = require('../server/notifyHomeAssistant'); // Import the notification function

async function processChargingData() {
    try {
        const end_time = new Date();
        const start_time = new Date();
        start_time.setDate(end_time.getDate() - 1); // Set to 24 hours before end_time
        const debug = false; // Disable debug by default

        // Invoke the function with the specified date range
        const chargingEvents = await getChargingIntervals(start_time, end_time, debug);

        console.log('Charging Events Detected:', chargingEvents, chargingEvents.length);

        // Trigger a notification for each identified charging event

        if (chargingEvents && chargingEvents.length > 0) {
            for (const event of chargingEvents) {
                const { dateTime, percentageCharged } = event;
                await notifyChargeEventIdentified(dateTime, percentageCharged);
            }
        }
    } catch (error) {
        console.error('Error executing charging data processing script:', error);
    }
}

// Run the charging data processing
processChargingData();
