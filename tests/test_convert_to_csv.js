//This function converts the input data to CSV to compare to Octopus own CSV output
const fs = require('fs');
const path = require('path');

const gas_or_electric = "gas";

// Load data from input.json
const inputFile = "../reports/report_20_09_24_10_14.json";
const inputData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const electricUsage = inputData.electric_usage;
const gasUsage = inputData.gas_usage;
const gasConversion = 11.22063333 //Taken from Octopus 20.09.24 - should load from tariff.json


// Function to convert electric usage to CSV format
function electricUsageToCSV(usageArray) {
    const headers = ["Consumption", "Usage", "Start", "End"];
    
    // Start with the headers
    const csvRows = [headers.join(',')];
    
    // Add each usage record
    usageArray.forEach(item => {
        const row = [
            item.consumption,       // Consumption
            0,                      // Usage (set to 0 as requested) - Can be created later
            item.interval_start,     // Start
            item.interval_end        // End
        ].join(',');
        csvRows.push(row);
    });
    
    // Join all rows with a new line
    return csvRows.join('\n');
}


// Function to convert ga usage to CSV format
function gasUsageToCSV(usageArray) {
    const headers = ["Consumption m3", "Consumption kWh", "Usage", "Start", "End"];
    
    // Start with the headers
    const csvRows = [headers.join(',')];
    
    // Add each usage record
    usageArray.forEach(item => {
        const row = [
            item.consumption,       // Consumption
            item.consumption * gasConversion,		// Consumption in kWh
            0,                      // Usage (set to 0 as requested) - Can be created later
            item.interval_start,     // Start
            item.interval_end        // End
        ].join(',');
        csvRows.push(row);
    });
    
    // Join all rows with a new line
    return csvRows.join('\n');
}

// Extract the file name without the extension from the input file path
const fileNameWithoutExtension = path.basename(inputFile, '.json');

// Create the output file path with the same name but with a `.csv` extension
const outputFile = path.join(path.dirname(inputFile), `${fileNameWithoutExtension}_${gas_or_electric}.csv`);


// Convert the electric or gas usage to CSV
let csvContent;
if (gas_or_electric === "electric") {
    csvContent = electricUsageToCSV(electricUsage);
} else if (gas_or_electric === "gas") {
    csvContent = gasUsageToCSV(gasUsage);
}


// Write the CSV content to a file
fs.writeFileSync(outputFile, csvContent);
console.log('CSV file created at:', outputFile);