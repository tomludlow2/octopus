const readline = require('readline');
const { fetchProcessAndInsertOctopusData } = require('./octopusDataProcessor');

function createResults(startDate, endDate) {
    return {
        success: [],
        failures: [],
        data: {},
        metadata: {
            start_time: startDate,
            end_time: endDate
        }
    };
}

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
async function runDailyDataProcessing(startDate, endDate, options = {}) {
    const { pauseBetweenDays = true } = options;
    let currentDate = new Date(startDate);
    const finalDate = new Date(endDate);

    while (currentDate <= finalDate) {
        const nextDate = new Date(currentDate);
        nextDate.setDate(currentDate.getDate() + 1);

        const formattedStartDate = currentDate.toISOString().split('T')[0];
        const formattedEndDate = nextDate.toISOString().split('T')[0];

        console.log(`Processing data from ${formattedStartDate} to ${formattedEndDate}`);

        const results = createResults(formattedStartDate, formattedEndDate);

        // Call the function for the current date range
        await fetchProcessAndInsertOctopusData(formattedStartDate, formattedEndDate, results);

        if (pauseBetweenDays) {
            // Wait for user input before moving to the next day
            await waitForUserInput();
        }

        currentDate = nextDate;
    }

    console.log('All data processed.');
}

if (require.main === module) {
    // Historical backfill helper defaults.
    runDailyDataProcessing('2024-11-10', '2024-11-16').catch((error) => {
        console.error('Failed to process daily data:', error);
        process.exitCode = 1;
    });
}

module.exports = { runDailyDataProcessing };
