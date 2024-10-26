const getChargingIntervals = require('./audiDataProcessor.js'); // Adjust this path as needed

(async () => {
    try {
        const start_time = new Date('2024-10-01T00:00:00Z');
        const end_time = new Date('2024-10-26T00:00:00Z');
        const debug = true; // Set to true to enable CSV and JSON export

        // Invoke the function with the specified date range and debug flag
        const chargingEvents = await getChargingIntervals(start_time, end_time, debug);

        console.log('Charging Events Detected:', chargingEvents);
    } catch (error) {
        console.error('Error executing test script:', error);
    }
})();
