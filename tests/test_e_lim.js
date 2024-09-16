// index.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load the config variables
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const apiKey = config.api_key;
const eMpan = config.e_mpan;
const eSn = config.e_sn;

const start_period = "2024-09-13T00:00Z";
const end_period = "2024-09-15T16:00Z";

// Set up the URL
const url = `https://api.octopus.energy/v1/electricity-meter-points/${eMpan}/meters/${eSn}/consumption/?page_size=100&period_from=${start_period}&period_to=${end_period}&order_by=period`;

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
