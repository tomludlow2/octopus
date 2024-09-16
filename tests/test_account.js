// index.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load the config variables
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const acc_num = config.account_num;
const apiKey = config.api_key;

// Set up the URL
const url = `https://api.octopus.energy/v1/accounts/${acc_num}/`;

// Perform the request
axios.get(url, {
  auth: {
    username: apiKey,
    password: ''
  }
})
.then(response => {
  console.log('API Response:', response.data);
  extract_tariff_information(response.data);
})
.catch(error => {
  console.error('Error fetching data:', error);
});


function extract_tariff_information(data) {
  // Extract required data
  const property = data.properties[0]; // Assuming you want the first property

  // Extract electricity tariff code with valid_to: null
  const electricityTariff = property.electricity_meter_points[0].agreements.find(
    (agreement) => agreement.valid_to === null
  );

  // Extract gas tariff code with valid_to: null
  const gasTariff = property.gas_meter_points[0].agreements.find(
    (agreement) => agreement.valid_to === null
  );

  // Prepare the data for tariff.json
  const tariffData = {
    number: data.number,
    electricity_tariff_code: electricityTariff.tariff_code,
    gas_tariff_code: gasTariff.tariff_code
  };

  // Write the data to ../tariff.json
  const outputPath = path.join(__dirname, '../tariff.json');
  fs.writeFileSync(outputPath, JSON.stringify(tariffData, null, 2), 'utf8');

  console.log('Tariff data saved to ../tariff.json');

  console.log(tariffData);
}