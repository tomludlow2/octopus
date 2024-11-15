const getChargingIntervals = require('./audiDataProcessor'); // Adjust this path as needed
const { notifyChargeEventIdentified } = require('../server/notifyHomeAssistant'); // Import the notification function

async function processChargingData() {
    try {
        const now = new Date();
        const end_time = new Date();
        end_time.setHours(now.getHours() < 12 ? 12 : 20, 0, 0, 0); // Set to next midday or 8 PM

        const start_time = new Date();
        start_time.setDate(end_time.getDate() - 2); // Start 48 hours before the end_time

        const debug = true; // Disable debug by default

        const chargingEvents = await getChargingIntervals(start_time, end_time, debug);

        console.log('Charging Events Detected:', chargingEvents, chargingEvents.length);

        if (chargingEvents && chargingEvents.length > 0) {
            for (const event of chargingEvents) {
                const { dateTime, percentageCharged } = event;
                console.log(event);
                await notifyChargeEventIdentified(dateTime, percentageCharged);
            }
        }
    } catch (error) {
        console.error('Error executing charging data processing script:', error);
    }
}

processChargingData();