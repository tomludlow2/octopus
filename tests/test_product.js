// index.js
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
const gas_product_code = tariff.gas_product_code;
const electricity_tariff_code = tariff.electricity_tariff_code;
const gas_tariff_code = tariff.gas_tariff_code;

const apiKey = config.api_key;

// Set up the URL
const url = `https://api.octopus.energy/v1/products/${electric_product_code}/`;
const url2 = `https://api.octopus.energy/v1/products/${gas_product_code}/`;

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
  const outputFilePath = path.join(__dirname, '../TEST_ELECTRIC_TARIFF.json');

  // Write the API response data to ../all_tariffs.json
  fs.writeFileSync(outputFilePath, JSON.stringify(response.data, null, 2), 'utf8');

  console.log('API response written to ../TEST_ELECTRIC_TARIFF.json');
  
})
.catch(error => {
  console.error('Error fetching data:', error);
});



// Perform the request
axios.get(url2, {
  auth: {
    username: apiKey,
    password: ''
  }
})
.then(response => {
  console.log('API Response:', response.data);
  // Path to save the JSON output
  const outputFilePath = path.join(__dirname, '../TEST_GAS_TARIFF.json');

  // Write the API response data to ../all_tariffs.json
  fs.writeFileSync(outputFilePath, JSON.stringify(response.data, null, 2), 'utf8');

  console.log('API response written to ../TEST_GAS_TARIFF.json');
  
})
.catch(error => {
  console.error('Error fetching data:', error);
});

