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
console.log(url);

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
  console.log(property.electricity_meter_points[0].agreements);
  const electricityTariff = property.electricity_meter_points[0].agreements.find(
    (agreement) => agreement.valid_to === null
  );

  // Extract gas tariff code with valid_to: null
  console.log(property.gas_meter_points[0].agreements);
  const gasTariff = property.gas_meter_points[0].agreements.find(
    (agreement) => agreement.valid_to === null
  );

  // Prepare the data for tariff.json
  const tariffData = {
    number: data.number,
    electricity_tariff_code: electricityTariff.tariff_code,
    gas_tariff_code: gasTariff.tariff_code,
    gas_product_code: "collect",
    electric_product_code: "collect",
    gas_conversion: "collect"
  };

  // Write the data to ../tariff.json
  const outputPath = path.join(__dirname, '../tariff.json');
  fs.writeFileSync(outputPath, JSON.stringify(tariffData, null, 2), 'utf8');

  console.log('Tariff data saved to ../tariff.json');

  console.log(`\n\tPlease note this function has only found out your SPECIFIC gas tariff code (${gasTariff.tariff_code}) and electric tariff (${electricityTariff.tariff_code}). You now need to get three more pieces of information to fill the tariff file:`);
  console.log("\n\tYou need gas_conversion - this can be found either on your bill, from the local gas supplier, or by comparing the octopus download data from your own data and dividing the Octopus consumption by the API consumption. This is the conversion from cubic meteres to kWh - only applicable to SMETS2 meters - currently 11.22063333");
  console.log("\n\tYou need to get your PRODUCT CODES for gas and electric. The tariff codes are a \'subset\' of the product codes. To do this, run test_all_products.js. This will generate all_tariffs.json" );
  console.log("\n\tWithin all_tariffs.json, look through and find a global electric product that might include your specific tariff, for example E-1R-INTELLI-VAR-22-10-14-M matches GO-VAR-22-10-14. Take this PRODUCT CODE and put it in electric_product_code in tariff.json");
  console.log("\n\tThen run test_product.js which will take the gas and electric product codes, and output the SPECIFIC tariffs within each product to TEST_ELECTRIC/GAS_TARIFF.json");
  console.log("\n\tYou can then perform a manual check that the tariff exists within the product.");


  console.log(tariffData);
}