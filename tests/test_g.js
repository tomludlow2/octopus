//This function simply loads your consumption, where more than one page of data, response.data.next provide the next data.

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load the config variables
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const apiKey = config.api_key;
const eMpan = config.g_mprn;
const eSn = config.g_sn;

// Set up the URL
const url = `https://api.octopus.energy/v1/gas-meter-points/${eMpan}/meters/${eSn}/consumption/`;

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
