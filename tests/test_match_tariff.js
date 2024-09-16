const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load the config variables
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Load the tariff variables
const tariffPath = path.join(__dirname, '../tariff.json');
const tariff = JSON.parse(fs.readFileSync(tariffPath, 'utf8'));

const product_code = tariff.product_code;
const electricity_tariff_code = tariff.electricity_tariff_code;
const gas_tariff_code = tariff.gas_tariff_code;

const apiKey = config.api_key;

// Set up the URL
const url = `https://api.octopus.energy/v1/products/${product_code}/`;

// Perform the request
axios.get(url, {
  auth: {
    username: apiKey,
    password: ''
  }
})
.then(response => {
  console.log('API Response:', response.data);

  // Now, let's search for the electricity_tariff_code in the response
  let foundTariff = false;

  // Get the single_register_electricity_tariffs object
  const electricityTariffs = response.data.single_register_electricity_tariffs || {};

  // Loop through the keys of the object
  for (const key in electricityTariffs) {
    if (electricityTariffs.hasOwnProperty(key)) {
      const tariff = electricityTariffs[key];

      // Check if direct_debit_monthly and code exist in the tariff
      if (tariff.direct_debit_monthly && tariff.direct_debit_monthly.code === electricity_tariff_code) {
        foundTariff = true;
        break; // Exit loop if found
      }
    }
  }

  // Output whether the tariff was found or not
  if (foundTariff) {
    console.log('Found Tariff:', electricity_tariff_code);
  } else {
    console.log('Tariff not found:', electricity_tariff_code);
  }
  
})
.catch(error => {
  console.error('Error fetching data:', error);
});
