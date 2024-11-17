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
async function fetchProcessAndInsertOctopusData(startDate, endDate, results) {
    try {
        // Append 'T00:00:00Z' to the dates if no time component is present
        const start_period = hasTime(startDate) ? startDate : `${startDate}T00:00:00Z`;
        const end_period = hasTime(endDate) ? endDate : `${endDate}T00:00:00Z`;

        // Fetch Octopus data
        const octopusData = await getOctopusData(start_period, end_period, results);
            Object.entries(octopusData.data).forEach(([key, value]) => {
            console.log(`${key}: ${value}`);
        });

        // Process prices
        const processedData = processPrices(octopusData, results);

        // Save processed data to the results object
        results.data.processed_data = processedData;

        // Save the processed data to a JSON file
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-based
        const yy = String(now.getFullYear()).slice(-2);
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const outputFileName = `report_processed_${dd}_${mm}_${yy}_${hh}_${min}.json`;
        const outputFilePath = path.join(__dirname, `../reports/${outputFileName}`);

        fs.writeFileSync(outputFilePath, JSON.stringify(processedData, null, 2), 'utf8');
        console.log(`Processed data saved to: ${outputFilePath}`);
        results.metadata.output_file_path = outputFilePath;

        // Insert gas consumption data
        //console.log("PROCESSED DATA: ", processedData);
        await insertGasConsumption(processedData.data.gas_usage)
            .then(() => results.success.push({ description: 'Gas consumption data inserted.' }))
            .catch(err => results.failures.push({
                description: 'Failed to insert gas consumption data',
                error: err.message
            }));

        // Insert electric consumption data
        await insertElectricConsumption(processedData.data.electric_usage)
            .then(() => results.success.push({ description: 'Electric consumption data inserted.' }))
            .catch(err => results.failures.push({
                description: 'Failed to insert electric consumption data',
                error: err.message
            }));

        // Prepare standing charge data
        const scData = {
            electric_standing_charges: processedData.data.electric_standing_charges,
            gas_standing_charges: processedData.data.gas_standing_charges
        };

        // Insert standing charges
        await insertStandingCharges(scData)
            .then(() => results.success.push({ description: 'Standing charges inserted.' }))
            .catch(err => results.failures.push({
                description: 'Failed to insert standing charges',
                error: err.message
            }));

    } catch (err) {
        results.failures.push({
            description: 'Critical failure in fetchProcessAndInsertOctopusData',
            timestamp: new Date().toISOString(),
            error: err.message || 'Unknown error',
        });
        console.error('Error fetching, processing, or inserting data:', err);
        throw err; // Rethrow the error to propagate it further
    }
}

module.exports = { fetchProcessAndInsertOctopusData };
