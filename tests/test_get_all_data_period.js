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

const start_period = '2024-08-25T00:00:00Z';
const end_period = '2024-08-25T23:59:59Z';

let output = {};

function get_electric_usage(start_period, end_period, apiKey, eMpan, eSn) {
    console.info("Collecting Electric Usage for Time Period");
    const url = `https://api.octopus.energy/v1/electricity-meter-points/${eMpan}/meters/${eSn}/consumption/?period_from=${start_period}&period_to=${end_period}&order_by=period`;

    return axios.get(url, {
        auth: {
            username: apiKey,
            password: ''
        }
    })
    .then(response => {
        console.log('Electric Usage API Response:', response.data);
        output.electric_usage = response.data.results;
    })
    .catch(error => {
        console.error('Error fetching data for electric usage:', error);
    });
}

function get_gas_usage(start_period, end_period, apiKey, gMran, gSn) {
    console.info("Collecting Gas Usage for Time Period");
    const url = `https://api.octopus.energy/v1/gas-meter-points/${gMran}/meters/${gSn}/consumption/?period_from=${start_period}&period_to=${end_period}&order_by=period`;

    return axios.get(url, {
        auth: {
            username: apiKey,
            password: ''
        }
    })
    .then(response => {
        console.log('Gas Usage API Response:', response.data);
        output.gas_usage = response.data.results;
    })
    .catch(error => {
        console.error('Error fetching data for gas usage:', error);
    });
}

function get_electric_unit_rates(start_period, end_period, apiKey, electricity_tariff_code, electric_product_code) {
    console.info("Collecting Electric Unit rates for the Time Period");
    const url = `https://api.octopus.energy/v1/products/${electric_product_code}/electricity-tariffs/${electricity_tariff_code}/standard-unit-rates/?period_from=${start_period}&period_to=${end_period}`;

    return axios.get(url, {
        auth: {
            username: apiKey,
            password: ''
        }
    })
    .then(response => {
        console.log('Electric Unit Rates API Response:', response.data);
        output.electric_usage_rates = response.data.results;
    })
    .catch(error => {
        console.error('Error fetching data for electric unit rates:', error);
    });
}

function get_gas_unit_rates(start_period, end_period, apiKey, gas_tariff_code, gas_product_code) {
    console.info("Collecting Gas Unit rates for the Time Period");
    const url = `https://api.octopus.energy/v1/products/${gas_product_code}/gas-tariffs/${gas_tariff_code}/standard-unit-rates/?period_from=${start_period}&period_to=${end_period}`;

    return axios.get(url, {
        auth: {
            username: apiKey,
            password: ''
        }
    })
    .then(response => {
        console.log('Gas Unit Rates API Response:', response.data);

        if (directDebit === true) {
            const directDebitResults = response.data.results.filter(result => result.payment_method === 'DIRECT_DEBIT');
            output.gas_unit_rates = directDebitResults;
        } else {
            const nonDirectDebitResults = response.data.results.filter(result => result.payment_method === 'NON_DIRECT_DEBIT');
            output.gas_unit_rates = nonDirectDebitResults;
        }
    })
    .catch(error => {
        console.error('Error fetching data for gas unit rates:', error);
    });
}

function get_electric_standing_charge(start_period, end_period, apiKey, electric_product_code, electricity_tariff_code) {
    console.info("Collecting Electric Standing Charges for the Time Period");
    const url = `https://api.octopus.energy/v1/products/${electric_product_code}/electricity-tariffs/${electricity_tariff_code}/standing-charges/?period_from=${start_period}&period_to=${end_period}`;

    return axios.get(url, {
        auth: {
            username: apiKey,
            password: ''
        }
    })
    .then(response => {
        console.log('Electric Standing Charges API Response:', response.data);
        output.electric_standing_charges = response.data.results;
    })
    .catch(error => {
        console.error('Error fetching data for electric standing charges:', error);
    });
}

function get_gas_standing_charge(start_period, end_period, apiKey, gas_product_code, gas_tariff_code) {
    console.info("Collecting Gas Standing Charges for the Time Period");
    const url = `https://api.octopus.energy/v1/products/${gas_product_code}/gas-tariffs/${gas_tariff_code}/standing-charges/?period_from=${start_period}&period_to=${end_period}`;

    return axios.get(url, {
        auth: {
            username: apiKey,
            password: ''
        }
    })
    .then(response => {
        console.log('Gas Standing Charges API Response:', response.data);

        if (directDebit === true) {
            const directDebitResults = response.data.results.filter(result => result.payment_method === 'DIRECT_DEBIT');
            output.gas_standing_charges = directDebitResults;
        } else {
            const nonDirectDebitResults = response.data.results.filter(result => result.payment_method === 'NON_DIRECT_DEBIT');
            output.gas_standing_charges = nonDirectDebitResults;
        }
    })
    .catch(error => {
        console.error('Error fetching data for gas standing charges:', error);
    });
}

async function collectData() {
    try {
        await get_electric_usage(start_period, end_period, apiKey, eMpan, eSn);
        await get_gas_usage(start_period, end_period, apiKey, gMran, gSn);
        await get_electric_unit_rates(start_period, end_period, apiKey, electricity_tariff_code, electric_product_code);
        await get_gas_unit_rates(start_period, end_period, apiKey, gas_tariff_code, gas_product_code);
        await get_electric_standing_charge(start_period, end_period, apiKey, electric_product_code, electricity_tariff_code);
        await get_gas_standing_charge(start_period, end_period, apiKey, gas_product_code, gas_tariff_code);

        console.log('Final Output:', output);
    } catch (error) {
        console.error('Error in collecting data:', error);
    }
}

// Start collecting data
collectData();
