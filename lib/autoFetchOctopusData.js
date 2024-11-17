const { fetchProcessAndInsertOctopusData } = require('./octopusDataProcessor');
const generateOctopusNotification = require('/var/www/notify/templates/octopus_generate_notification');


async function autoFetchOctopusData(formattedStartDate, formattedEndDate) {
    console.log(`Processing data from ${formattedStartDate} to ${formattedEndDate}`);

    const results = {
        success: [],
        failures: [],
        data: {},
        metadata: {
            start_time: formattedStartDate,
            end_time: formattedEndDate
        }
    };

    try {
        // Call the processing function with the shared results object
        await fetchProcessAndInsertOctopusData(formattedStartDate, formattedEndDate, results);
        //console.log( "HERE IT IS\n\n\n" + results);

        console.log('Data processed for the last 24 hours!');
        console.log('Successes:', results.success);
        console.warn('Failures:', results.failures);
    } catch (error) {
        console.error('Error processing data:', error);
        results.failures.push({
            description: 'Critical failure in autoFetchOctopusData',
            timestamp: new Date().toISOString(),
            error: error.message || 'Unknown error',
        });
    } finally {
        // Call the notification generator with the full results object
        try {
            await generateOctopusNotification(results);
            console.log('Notification generated successfully.');
        } catch (notificationError) {
            console.error('Error generating notification:', notificationError);
        }
    }

    return results; // Return results for debugging or further use
}

module.exports = { autoFetchOctopusData };
