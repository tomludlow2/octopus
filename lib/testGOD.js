const { getOctopusData } = require('./getOctopusData.js');
const { processPrices } = require('./processPrices');
const { insertGasConsumption } = require('./gasInsert.js');
const { insertElectricConsumption } = require('./electricInsert.js');
const { insertStandingCharges } = require('./standingChargeInsert.js');

const path = require('path');
const fs = require('fs');

// Helper to format dates for filenames
function formatDateForFilename() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const yy = String(now.getFullYear()).slice(-2);
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${dd}_${mm}_${yy}_${hh}_${min}`;
}

// Helper function for inserting data and handling success/failure
async function handleInsertion(description, insertFn, data) {
    try {
        const outcome = await insertFn(data);
        console.log(`${description}: Success`, outcome);
    } catch (error) {
        console.error(`${description}: Failed`, error);
    }
}

async function testGetOctopusData(startDate, endDate) {
    // Check if startDate and endDate already include a time component
    const hasTime = date => date.includes('T');

    // Append 'T00:00:00Z' only if no time component is found
    const start_period = hasTime(startDate) ? startDate : `${startDate}T00:00:00Z`;
    const end_period = hasTime(endDate) ? endDate : `${endDate}T00:00:00Z`;

    return await getOctopusData(start_period, end_period);
}

// Main processing function
async function processOctopusData(startDate, endDate) {
    try {
        // Fetch data
        const results = await testGetOctopusData(startDate, endDate);

        // Log any failures for debugging
        if (results.failures.length > 0) {
            console.warn('Failures encountered during data fetch:', results.failures);
        }

        // Process prices
        const newData = processPrices(results.data);

        // Save processed data to a JSON file
        const outputFileName = `report_processed_${formatDateForFilename()}.json`;
        const outputFilePath = path.join(__dirname, `../reports/${outputFileName}`);
        fs.writeFileSync(outputFilePath, JSON.stringify(newData, null, 2), 'utf8');
        console.log(`Processed data saved to: ${outputFilePath}`);

        // Insert gas consumption data
        await handleInsertion('Gas consumption data insertion', insertGasConsumption, newData.gas_usage);

        // Insert electric consumption data
        await handleInsertion('Electric consumption data insertion', insertElectricConsumption, newData.electric_usage);

        // Prepare standing charges data
        const scData = {
            electric_standing_charges: newData.electric_standing_charges,
            gas_standing_charges: newData.gas_standing_charges,
        };

        // Insert standing charges data
        await handleInsertion('Standing charges data insertion', insertStandingCharges, scData);

        console.log('Octopus data processing completed successfully.');
    } catch (err) {
        console.error('Error during Octopus data processing:', err);
    }
}

// Call the function with test parameters
processOctopusData('2024-09-11', '2024-10-01');
