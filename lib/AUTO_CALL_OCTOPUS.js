const { autoFetchOctopusData } = require('./autoFetchOctopusData');

async function runLastPeriod() {
    const endDate = new Date(); // Current time
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 4); // Subtract 4 days for the start date
    endDate.setDate(endDate.getDate() - 2); // Subtract 2 days for the end date

    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];

    console.log(`Running auto-fetch process for data from ${formattedStartDate} to ${formattedEndDate}`);

    try {
        const results = await autoFetchOctopusData(formattedStartDate, formattedEndDate);
        console.log('Process completed successfully:', results);
    } catch (error) {
        console.error('Error running auto-fetch process:', error);
    }
}

// Execute the function
runLastPeriod();
