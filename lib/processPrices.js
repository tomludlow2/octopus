const fs = require('fs');
const path = require('path');

// Load tariff.json for the gas conversion factor
const tariff = JSON.parse(fs.readFileSync(path.join(__dirname, "../tariff.json"), 'utf8'));

// Function to round a number to the nearest 0.01
function roundToNearest(value, precision) {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
}

// Function to calculate the price for each electric usage item
function addPriceToUsage(usage, rates) {
    return usage.map(usageItem => {
        const matchingRate = rates.find(rate => {
            const rateStart = new Date(rate.valid_from).getTime();
            const rateEnd = rate.valid_to ? new Date(rate.valid_to).getTime() : Infinity;
            const usageTimestamp = new Date(usageItem.interval_start).getTime();

            // Check if usage falls within rate's validity period
            return usageTimestamp >= rateStart && usageTimestamp < rateEnd;
        });

        if (matchingRate) {
            const roundedConsumption = roundToNearest(usageItem.consumption, 2);
            usageItem.price = roundedConsumption * matchingRate.value_exc_vat;
        } else {
            usageItem.price = 0;
            console.warn(`No matching rate found for electric usage interval starting at ${usageItem.interval_start}`);
        }

        return usageItem;
    });
}

function addPriceToUsageGas(usage, rates, conversion) {
    return usage.map(usageItem => {
        const matchingRate = rates.find(rate => {
            const rateStart = new Date(rate.valid_from).getTime();
            const rateEnd = rate.valid_to ? new Date(rate.valid_to).getTime() : Infinity;
            const usageTimestamp = new Date(usageItem.interval_start).getTime();

            return usageTimestamp >= rateStart && usageTimestamp < rateEnd;
        });

        if (matchingRate) {
            usageItem.consumption = usageItem.consumption * conversion;
            const roundedConsumption = roundToNearest(usageItem.consumption, 2);
            usageItem.price = roundedConsumption * matchingRate.value_inc_vat;
        } else {
            usageItem.price = 0;
            console.warn(`No matching rate found for gas usage interval starting at ${usageItem.interval_start}`);
        }

        return usageItem;
    });
}

// Main processPrices function
function processPrices(octopusData) {
    const { electric_usage, electric_unit_rates, gas_usage, gas_unit_rates } = octopusData;

    // Add price to electric usage
    const updatedElectricUsage = addPriceToUsage(electric_usage, electric_unit_rates);
    
    // Add price to gas usage (use conversion factor from tariff.json)
    const updatedGasUsage = addPriceToUsageGas(gas_usage, gas_unit_rates, tariff.gas_conversion);

    // Replace the old usage data with the updated one
    octopusData.electric_usage = updatedElectricUsage;
    octopusData.gas_usage = updatedGasUsage;

    // Return the updated octopusData object
    return octopusData;
}

// Export the module
module.exports = { processPrices };
