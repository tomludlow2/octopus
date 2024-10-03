const readline = require('readline');
const { fetchProcessAndInsertOctopusData } = require('./octopusDataProcessor');

// Function to pause and wait for user input
function waitForUserInput() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question('Press Enter to proceed to the next day...', () => {
            rl.close();
            resolve();
        });
    });
}

// Function to iterate through each day
async function runDailyDataProcessing(startDate, endDate) {
    let currentDate = new Date(startDate);
    const finalDate = new Date(endDate);

    while (currentDate <= finalDate) {
        const nextDate = new Date(currentDate);
        nextDate.setDate(currentDate.getDate() + 1);

        const formattedStartDate = currentDate.toISOString().split('T')[0];
        const formattedEndDate = nextDate.toISOString().split('T')[0];

        console.log(`Processing data from ${formattedStartDate} to ${formattedEndDate}`);

        // Call the function for the current date range
        await fetchProcessAndInsertOctopusData(formattedStartDate, formattedEndDate);

        // Wait for user input before moving to the next day
        await waitForUserInput();

        currentDate = nextDate;
    }

    console.log('All data processed!');
}

// Start iterating from 2024-09-01
runDailyDataProcessing('2024-09-01', '2024-09-30');
