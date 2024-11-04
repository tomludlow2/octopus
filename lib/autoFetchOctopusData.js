// octopusDataScheduler.js
const { fetchProcessAndInsertOctopusData } = require('./octopusDataProcessor');
const { notifyOctopusDataFetched } = require('../server/notifyHomeAssistant');

async function runDataProcessingForLast24Hours() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 1);

    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];

    console.log(`Processing data from ${formattedStartDate} to ${formattedEndDate}`);

    try {
        // Call the function for the last 24 hours
        await fetchProcessAndInsertOctopusData(formattedStartDate, formattedEndDate);
        console.log('Data processed for the last 24 hours!');

        // Trigger notification if processing is successful
        await notifyOctopusDataFetched();
    } catch (error) {
        console.error('Error processing data:', error);
    }
}

// Run the data processing
runDataProcessingForLast24Hours();
