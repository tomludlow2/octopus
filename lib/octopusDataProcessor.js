const { getOctopusData } = require('./getOctopusData.js');
const { processPrices } = require('./processPrices');
const { insertGasConsumption } = require('./gasInsert.js');
const { insertElectricConsumption } = require('./electricInsert.js');
const { insertStandingCharges } = require('./standingChargeInsert.js');

const path = require('path');
const fs = require('fs');

// Utility function to check if a date string has a time component
function hasTime(date) {
    return date.includes('T');
}

// Function to fetch Octopus data, process it, and insert it into the database
async function fetchProcessAndInsertOctopusData(startDate, endDate) {
    try {
        // Append 'T00:00:00Z' to the dates if no time component is present
        const start_period = hasTime(startDate) ? startDate : `${startDate}T00:00:00Z`;
        const end_period = hasTime(endDate) ? endDate : `${endDate}T00:00:00Z`;

        // Fetch Octopus data
        const octopusData = await getOctopusData(start_period, end_period);

        // Process prices
        const newData = processPrices(octopusData);

        // Save the processed data to a JSON file
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-based
        const yy = String(now.getFullYear()).slice(-2);
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const outputFileName = `report_processed_${dd}_${mm}_${yy}_${hh}_${min}.json`;
        const outputFilePath = path.join(__dirname, `../reports/${outputFileName}`);

        fs.writeFileSync(outputFilePath, JSON.stringify(newData, null, 2), 'utf8');
        console.log(`Processed data saved to: ${outputFilePath}`);

        // Insert gas consumption data
        await insertGasConsumption(newData.gas_usage);
        console.log('Gas consumption data inserted.');

        // Insert electric consumption data
        await insertElectricConsumption(newData.electric_usage);
        console.log('Electric consumption data inserted.');

        // Prepare standing charge data
        const scData = {
            electric_standing_charges: newData.electric_standing_charges,
            gas_standing_charges: newData.gas_standing_charges
        };

        // Insert standing charges
        await insertStandingCharges(scData);
        console.log('Standing charges inserted.');
    } catch (err) {
        console.error('Error fetching, processing, or inserting data:', err);
    }
}

module.exports = { fetchProcessAndInsertOctopusData };
