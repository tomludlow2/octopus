//Get the specific unit rates for a defined period of time. Relies on electric_product_code being set in tariff.json or will throw a 404
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load the config variables
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

//Load the tariff variables
const tariffPath = path.join(__dirname, '../tariff.json');
const tariff = JSON.parse(fs.readFileSync(tariffPath, 'utf8'));

const electric_product_code = tariff.electric_product_code;
const electricity_tariff_code = tariff.electricity_tariff_code;
const gas_tariff_code = tariff.gas_tariff_code;

const apiKey = config.api_key;

const start_period = '2024-10-01T00:00:00Z';
const end_period = '2024-10-01T23:59:59Z';

// Set up the URL
const url = `https://api.octopus.energy/v1/products/${electric_product_code}/electricity-tariffs/${electricity_tariff_code}/standard-unit-rates/?period_from=${start_period}&period_to=${end_period}`;

// Perform the request
axios.get(url, {
  auth: {
    username: apiKey,
    password: ''
  }
})
.then(response => {
  console.log('API Response:', response.data);
  // Path to save the JSON output
  //const outputFilePath = path.join(__dirname, '../GO_VAR.json');

  // Write the API response data to ../all_tariffs.json
  //fs.writeFileSync(outputFilePath, JSON.stringify(response.data, null, 2), 'utf8');

  //console.log('API response written to ../GO_VAR.json');
  
})
.catch(error => {
  console.error('Error fetching data:', error);
});

