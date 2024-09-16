// test_gsp.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load the config variables (adjust the path to point to the correct config file)
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const apiKey = config.api_key;
const postcode = config.postcode; // Optional postcode filter

// Set up the URL with optional postcode filtering
let url = 'https://api.octopus.energy/v1/industry/grid-supply-points/';
if (postcode) {
  url += `?postcode=${postcode}`;
}

// Perform the request
axios.get(url, {
  auth: {
    username: apiKey,
    password: ''
  }
})
.then(response => {
  console.log('API Response:', response.data);
})
.catch(error => {
  console.error('Error fetching data:', error);
});
