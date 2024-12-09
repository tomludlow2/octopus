const getChargingIntervals = require('./audiDataProcessor');

async function autoIdentifyChargeEvent(start_time, end_time) {
    console.log(`Processing charging data from ${start_time} to ${end_time}`);

    const results = {
        success: [],
        failures: [],
        data: {},
        metadata: {
            start_time: start_time.toISOString(),
            end_time: end_time.toISOString()
        }
    };

    try {
        // Call the processor with the results object
        await getChargingIntervals(start_time, end_time, results);

        console.log('Charging events processed:', results.data.chargingEvents?.length || 0);
    } catch (error) {
        console.error('Error processing charging events:', error);
        results.failures.push({
            description: 'Critical failure in autoIdentifyChargeEvent',
            timestamp: new Date().toISOString(),
            error: error.message || 'Unknown error'
        });
    }

    return results; // Return results for debugging or further use
}

module.exports = { autoIdentifyChargeEvent };
