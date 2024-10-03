const {getOctopusData} = require('./getOctopusData.js');
const { processPrices } = require('./processPrices');
const { insertGasConsumption } = require('./gasInsert.js');
const { insertElectricConsumption } = require('./electricInsert.js');
const { insertStandingCharges } = require('./standingChargeInsert.js');

const path = require('path');
const fs = require('fs');

async function testGetOctopusData(startDate, endDate) {
    // Check if startDate and endDate already include a time component
    const hasTime = date => date.includes('T');

    // Append 'T00:00:00Z' only if no time component is found
    const start_period = hasTime(startDate) ? startDate : `${startDate}T00:00:00Z`;
    const end_period = hasTime(endDate) ? endDate : `${endDate}T00:00:00Z`;

    return await getOctopusData(start_period, end_period);
}

async function inputGas(gasData) {
    return await insertGasConsumption(gasData);
}

async function inputElectric(electricData) {
    return await insertElectricConsumption(electricData);
}

async function inputStandingCharge(scData) {
    return await insertStandingCharges(scData);
}

// Call the function and process the data
testGetOctopusData('2024-09-11', '2024-10-01')
    .then(octopusData => {
        // Assuming the returned data structure has electric_usage, gas_usage, electric_unit_rates, and gas_unit_rates
        const newData = processPrices(octopusData); // Pass the retrieved data to processPrices
        //console.log(newData);

        // Path to save the JSON output
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-based
        const yy = String(now.getFullYear()).slice(-2);
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const outputFileName = `report_processed_${dd}_${mm}_${yy}_${hh}_${min}.json`;
        const outputFilePath = path.join(__dirname, `../reports/${outputFileName}`);

        fs.writeFileSync(outputFilePath, JSON.stringify(newData, null, 2), 'utf8');


        //Now going to attempt to insert gas consumption data
        inputGas(newData.gas_usage).then(outcome => {
            console.log(outcome);
        })
        .catch(err=> console.error('Error inserting gas:', err));

        //Now going to attempt to insert electric consumption data
        inputElectric(newData.electric_usage).then(outcome => {
            console.log(outcome);
        })
        .catch(err=> console.error('Error inserting electric:', err));



        const scData = {};
        scData.electric_standing_charges = newData.electric_standing_charges;
        scData.gas_standing_charges = newData.gas_standing_charges;

        console.log( scData);
        //Now going to attempt to insert standing charge data
        inputStandingCharge(scData).then(outcome => {
            console.log(outcome);
        })
        .catch(err=> console.error('Error inserting standing charges:', err));



    })
    .catch(err => console.error('Error:', err));
