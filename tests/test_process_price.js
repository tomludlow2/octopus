const fs = require('fs');
const path = require('path');

// Load data from input.json
const inputFilePath = '../reports/report_20_09_24_10_14.json';
const inputData = JSON.parse(fs.readFileSync(inputFilePath, 'utf8'));
const electricUsage = inputData.electric_usage;
const electricUsageRates = inputData.electric_usage_rates; // Load rates from input.json

// Function to round a number to the nearest 0.01
function roundToNearest(value, precision) {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
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
            // Round the consumption to the nearest 0.01kwh.
            const roundedConsumption = roundToNearest(usageItem.consumption,2);
            //If you want to compare to octopus CSV data use exc vat
            //usageItem.price = roundedConsumption * matchingRate.value_exc_vat;
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

// Extract the input file name without extension
const inputFileName = path.basename(inputFilePath, '.json');

// Create the output file name with '_prices' suffix for JSON
const outputFileName = `${inputFileName}_prices.json`;
const outputFilePath = path.join(path.dirname(inputFilePath), outputFileName);

// Create the CSV file name for electric usage
const csvFileName = `${inputFileName}_prices_electric.csv`;
const csvFilePath = path.join(path.dirname(inputFilePath), csvFileName);

// Log the updated input data (which now includes the price for each usage item)
console.log(JSON.stringify(inputData, null, 2));

// Write the updated data to a new JSON file
fs.writeFileSync(outputFilePath, JSON.stringify(inputData, null, 2));
console.log(`Updated data written to ${outputFilePath}`);

// Function to convert electric usage to CSV format
function electricUsageToCSV(usageArray) {
    const headers = ["Consumption", "Price", "Start", "End"];
    
    // Start with the headers
    const csvRows = [headers.join(',')];
    
    // Add each usage record
    usageArray.forEach(item => {
        const row = [
            (item.consumption),       // Consumption
            roundToNearest(item.price, 2),              // Price
            item.interval_start,                         // Start
            item.interval_end                            // End
        ].join(',');
        csvRows.push(row);
    });
    
    // Join all rows with a new line
    return csvRows.join('\n');
}

// Write the CSV content to a file
const csvContent = electricUsageToCSV(updatedElectricUsage);
fs.writeFileSync(csvFilePath, csvContent);
console.log(`CSV file created at: ${csvFilePath}`);
