const { fetchProcessAndInsertOctopusData } = require('./octopusDataProcessor');
const { loadOptionalModule } = require('./loadOptionalModule');

const generateOctopusNotification = loadOptionalModule([
    process.env.OCTOPUS_NOTIFY_MODULE,
    '/var/www/notify/templates/octopus_generate_notification'
]);

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
        await fetchProcessAndInsertOctopusData(formattedStartDate, formattedEndDate, results);
        console.log('Data processed for the requested period.');
    } catch (error) {
        console.error('Error processing data:', error);
        results.failures.push({
            description: 'Critical failure in autoFetchOctopusData',
            timestamp: new Date().toISOString(),
            error: error.message || 'Unknown error'
        });
    } finally {
        if (!generateOctopusNotification) {
            console.warn('Notification module not found. Skipping notification generation.');
            return results;
        }

        try {
            await generateOctopusNotification(results);
            console.log('Notification generated successfully.');
        } catch (notificationError) {
            console.error('Error generating notification:', notificationError);
        }
    }

    return results;
}

module.exports = { autoFetchOctopusData };
