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
async function get_electric_usage(start_period, end_period) {
    //console.log(`Getting energy data for ${start_period}`);
    const url = `https://api.octopus.energy/v1/electricity-meter-points/${eMpan}/meters/${eSn}/consumption/?period_from=${start_period}&period_to=${end_period}&order_by=period`;

    try {

        const response = await axios.get(url, { auth: { username: apiKey, password: '' } });
        return response.data.results;
    } catch (error) {
        console.error('Error fetching electric usage:', error);
        throw error;
    }
}

async function get_gas_usage(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/gas-meter-points/${gMran}/meters/${gSn}/consumption/?period_from=${start_period}&period_to=${end_period}&order_by=period`;

    try {
        const response = await axios.get(url, { auth: { username: apiKey, password: '' } });
        return response.data.results; // Return the gas usage data
    } catch (error) {
        console.error(`Error fetching gas usage for period ${start_period} to ${end_period}:`, error.message);
        throw new Error(`Failed to fetch gas usage: ${error.message}`);
    }
}


async function get_electric_unit_rates(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/products/${electric_product_code}/electricity-tariffs/${electricity_tariff_code}/standard-unit-rates/?period_from=${start_period}&period_to=${end_period}`;

    try {
        const response = await axios.get(url, { auth: { username: apiKey, password: '' } });
        return response.data.results; // Return electric unit rates
    } catch (error) {
        console.error(`Error fetching electric unit rates for period ${start_period} to ${end_period}:`, error.message);
        throw new Error(`Failed to fetch electric unit rates: ${error.message}`);
    }
}


async function get_gas_unit_rates(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/products/${gas_product_code}/gas-tariffs/${gas_tariff_code}/standard-unit-rates/?period_from=${start_period}&period_to=${end_period}`;

    try {
        const response = await axios.get(url, { auth: { username: apiKey, password: '' } });

        // Filter based on payment method
        return directDebit
            ? response.data.results.filter(result => result.payment_method === 'DIRECT_DEBIT')
            : response.data.results.filter(result => result.payment_method === 'NON_DIRECT_DEBIT');
    } catch (error) {
        console.error(`Error fetching gas unit rates for period ${start_period} to ${end_period}:`, error.message);
        throw new Error(`Failed to fetch gas unit rates: ${error.message}`);
    }
}


async function get_electric_standing_charge(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/products/${electric_product_code}/electricity-tariffs/${electricity_tariff_code}/standing-charges/?period_from=${start_period}&period_to=${end_period}`;

    try {
        const response = await axios.get(url, { auth: { username: apiKey, password: '' } });
        return response.data.results; // Return electric standing charges
    } catch (error) {
        console.error(`Error fetching electric standing charges for period ${start_period} to ${end_period}:`, error.message);
        throw new Error(`Failed to fetch electric standing charges: ${error.message}`);
    }
}


async function get_gas_standing_charge(start_period, end_period) {
    const url = `https://api.octopus.energy/v1/products/${gas_product_code}/gas-tariffs/${gas_tariff_code}/standing-charges/?period_from=${start_period}&period_to=${end_period}`;

    try {
        const response = await axios.get(url, { auth: { username: apiKey, password: '' } });

        // Filter based on payment method
        return directDebit
            ? response.data.results.filter(result => result.payment_method === 'DIRECT_DEBIT')
            : response.data.results.filter(result => result.payment_method === 'NON_DIRECT_DEBIT');
    } catch (error) {
        console.error(`Error fetching gas standing charges for period ${start_period} to ${end_period}:`, error.message);
        throw new Error(`Failed to fetch gas standing charges: ${error.message}`);
    }
}


// Main function to collect all data
async function getOctopusData(start_date, end_date) {


    //Collect results for notification purposes:
    const results = {
        success: [],
        failures:  [],
        data: {
            electric_usage: null,
            gas_usage:null,
            electric_unit_rates: null,
            gas_unit_rates: null,
            electric_standing_charges: null,
            gas_standing_charges: null,
        },
        metadata: {
            start_time: start_date,
            end_time: end_date
        }
    }

    const start_period = `${start_date}`;
    const end_period = `${end_date}`;


    //Helper function to track the API results
    const handleApiCall = async (description, func, key) => {
        try {
            const data = await func(start_period, end_period);
            results.data[key] = data;
            results.success.push({description, key, timestamp: new Date().toISOString()});
        }catch (error) {
            results.failures.push({
                description,
                key,
                timestamp: new Date().toISOString(),
                error: error.message || 'Unknown error'
            });
        }
    }

    try {
        // Fetch all data and track successes/failures
        await Promise.all([
            handleApiCall(
                'Fetching electric usage',
                get_electric_usage,
                'electric_usage'
            ),
            handleApiCall(
                'Fetching gas usage',
                get_gas_usage,
                'gas_usage'
            ),
            handleApiCall(
                'Fetching electric unit rates',
                get_electric_unit_rates,
                'electric_unit_rates'
            ),
            handleApiCall(
                'Fetching gas unit rates',
                get_gas_unit_rates,
                'gas_unit_rates'
            ),
            handleApiCall(
                'Fetching electric standing charges',
                get_electric_standing_charge,
                'electric_standing_charges'
            ),
            handleApiCall(
                'Fetching gas standing charges',
                get_gas_standing_charge,
                'gas_standing_charges'
            ),
        ]);

    } catch (criticalError) {
        console.error('Error collecting Octopus data:', criticalError);
        results.failures.push({
            description: 'Critical failure in fetching Octopus Data',
            timestamp: new Date().toISOString(),
            error: criticalError.message || 'Unknown critical error'
        })
        throw criticalError;
    }

    return results;
}

// Export the function for external usage
module.exports = { getOctopusData };
