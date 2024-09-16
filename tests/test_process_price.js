const fs = require('fs');

// Load data from input.json
const inputData = JSON.parse(fs.readFileSync('../reports/report_16_09_24_12_51.json', 'utf8'));
const electricUsage = inputData.electric_usage;
const electricUsageRates = inputData.electric_usage_rates; // Load rates from input.json

// Function to round a number to two decimal places
function roundToTwoDecimals(num) {
    return Math.round(num * 100) / 100;
}

// Function to calculate the price for each usage item
function addPriceToUsage(usage, rates) {
    return usage.map(usageItem => {
        const matchingRate = rates.find(rate => {
            const rateStart = new Date(rate.valid_from).getTime();
            const rateEnd = new Date(rate.valid_to).getTime();
            const usageTimestamp = new Date(usageItem.interval_start).getTime();

            // Check if usage falls within rate's validity period
            return usageTimestamp >= rateStart && usageTimestamp < rateEnd;
        });

        // If a matching rate is found, add the price property
        if (matchingRate) {
            // Round the consumption to two decimal places
            const roundedConsumption = roundToTwoDecimals(usageItem.consumption);
            usageItem.price = roundedConsumption * matchingRate.value_inc_vat;
        } else {
            usageItem.price = 0; // Set price to 0 if no matching rate is found
            console.warn(`No matching rate found for usage interval starting at ${usageItem.interval_start}`);
        }

        return usageItem;
    });
}

// Add price to each electric usage object
const updatedElectricUsage = addPriceToUsage(electricUsage, electricUsageRates);

// Update the original input data with the modified electric_usage
inputData.electric_usage = updatedElectricUsage;

// Log the updated input data (which now includes the price for each usage item)
console.log(JSON.stringify(inputData, null, 2));

// Optionally, write the updated data to a new file
fs.writeFileSync('./output.json', JSON.stringify(inputData, null, 2));
console.log('Updated data written to output.json');