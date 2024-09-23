const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load the config variables
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Load the tariff variables
const tariffPath = path.join(__dirname, '../tariff.json');
const tariff = JSON.parse(fs.readFileSync(tariffPath, 'utf8'));

const apiKey = config.api_key;
const eMpan = config.e_mpan;
const eSn = config.e_sn;
const gMran = config.g_mprn;
const gSn = config.g_sn;
const directDebit = config.direct_debit;
const electric_product_code = tariff.electric_product_code;
const gas_product_code = tariff.gas_product_code;
const electricity_tariff_code = tariff.electricity_tariff_code;
const gas_tariff_code = tariff.gas_tariff_code;

let output = {};

// Helper functions to collect data
function get_electric_usage(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/electricity-meter-points/${eMpan}/meters/${eSn}/consumption/?period_from=${start_period}&period_to=${end_period}&order_by=period`;
    return axios.get(url, { auth: { username: apiKey, password: '' } })
        .then(response => {
            output.electric_usage = response.data.results;
        })
        .catch(error => console.error('Error fetching electric usage:', error));
}

function get_gas_usage(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/gas-meter-points/${gMran}/meters/${gSn}/consumption/?period_from=${start_period}&period_to=${end_period}&order_by=period`;
    return axios.get(url, { auth: { username: apiKey, password: '' } })
        .then(response => {
            output.gas_usage = response.data.results;
        })
        .catch(error => console.error('Error fetching gas usage:', error));
}

function get_electric_unit_rates(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/products/${electric_product_code}/electricity-tariffs/${electricity_tariff_code}/standard-unit-rates/?period_from=${start_period}&period_to=${end_period}`;
    return axios.get(url, { auth: { username: apiKey, password: '' } })
        .then(response => {
            output.electric_unit_rates = response.data.results;
        })
        .catch(error => console.error('Error fetching electric unit rates:', error));
}

function get_gas_unit_rates(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/products/${gas_product_code}/gas-tariffs/${gas_tariff_code}/standard-unit-rates/?period_from=${start_period}&period_to=${end_period}`;
    return axios.get(url, { auth: { username: apiKey, password: '' } })
        .then(response => {
            if (directDebit) {
                output.gas_unit_rates = response.data.results.filter(result => result.payment_method === 'DIRECT_DEBIT');
            } else {
                output.gas_unit_rates = response.data.results.filter(result => result.payment_method === 'NON_DIRECT_DEBIT');
            }
        })
        .catch(error => console.error('Error fetching gas unit rates:', error));
}

function get_electric_standing_charge(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/products/${electric_product_code}/electricity-tariffs/${electricity_tariff_code}/standing-charges/?period_from=${start_period}&period_to=${end_period}`;
    return axios.get(url, { auth: { username: apiKey, password: '' } })
        .then(response => {
            output.electric_standing_charges = response.data.results;
        })
        .catch(error => console.error('Error fetching electric standing charges:', error));
}

function get_gas_standing_charge(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/products/${gas_product_code}/gas-tariffs/${gas_tariff_code}/standing-charges/?period_from=${start_period}&period_to=${end_period}`;
    return axios.get(url, { auth: { username: apiKey, password: '' } })
        .then(response => {
            if (directDebit) {
                output.gas_standing_charges = response.data.results.filter(result => result.payment_method === 'DIRECT_DEBIT');
            } else {
                output.gas_standing_charges = response.data.results.filter(result => result.payment_method === 'NON_DIRECT_DEBIT');
            }
        })
        .catch(error => console.error('Error fetching gas standing charges:', error));
}

// Main function to collect all data
async function getOctopusData(start_date, end_date) {
    const start_period = `${start_date}`;
    const end_period = `${end_date}`;

    try {
        // Collect data concurrently
        await Promise.all([
            get_electric_usage(start_period, end_period),
            get_gas_usage(start_period, end_period),
            get_electric_unit_rates(start_period, end_period),
            get_gas_unit_rates(start_period, end_period),
            get_electric_standing_charge(start_period, end_period),
            get_gas_standing_charge(start_period, end_period)
        ]);

        return output; // Return the collected data as JSON
    } catch (error) {
        console.error('Error collecting Octopus data:', error);
        throw error;
    }
}

// Export the function for external usage
module.exports = { getOctopusData };
