const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load the config variables
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Load the tariff variables
const tariffCode = "E-1R-INTELLI-VAR-22-10-14-M";
const tariffCode2 = "G-1R-VAR-22-11-01-M";

const apiKey = config.api_key;

// Set up the URL
const url = `https://api.octopus.energy/v1/products/`;

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
  const outputFilePath = path.join(__dirname, '../all_tariffs.json');

  // Write the API response data to ../all_tariffs.json
  fs.writeFileSync(outputFilePath, JSON.stringify(response.data, null, 2), 'utf8');

  console.log('API response written to ../all_tariffs.json');

  console.log("Please note that the codes outputted through this function don't directly match those which appear in the user's specific pricing structure. For example E-1R-INTELLI-VAR-22-10-14-M matches product code GO-VAR-22-10-14 ");
})
.catch(error => {
  console.error('Error fetching data:', error);
});
