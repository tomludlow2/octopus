const fs = require('fs');
const path = require('path');

// Load tariff.json for the gas conversion factor
const tariff = JSON.parse(fs.readFileSync(path.join(__dirname, "../tariff.json"), 'utf8'));

// Function to round a number to the nearest 0.01
function roundToNearest(value, precision) {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
}

// Function to calculate the price for electric usage
function addPriceToUsage(usage, rates, results) {
    if (!usage || !rates) {
        results.failures.push({ description: 'Electric usage or rates missing', type: 'electric' });
        return [];
    }
    
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
            results.success.push({
                description: `Electric usage priced successfully`,
                interval_start: usageItem.interval_start,
                price: usageItem.price,
            });
        } else {
            usageItem.price = 0;
            results.failures.push({
                description: `No matching rate found for electric usage`,
                interval_start: usageItem.interval_start,
            });
        }

        return usageItem;
    });
}

// Function to calculate the price for gas usage
function addPriceToUsageGas(usage, rates, conversion, results) {
    if (!usage || !rates) {
        results.failures.push({ description: 'Gas usage or rates missing', type: 'gas' });
        return [];
    }

    return usage.map(usageItem => {
        const matchingRate = rates.find(rate => {
            const rateStart = new Date(rate.valid_from).getTime();
            const rateEnd = rate.valid_to ? new Date(rate.valid_to).getTime() : Infinity;
            const usageTimestamp = new Date(usageItem.interval_start).getTime();

            return usageTimestamp >= rateStart && usageTimestamp < rateEnd;
        });

        if (matchingRate) {
            usageItem.consumption = usageItem.consumption * conversion; // Apply conversion factor
            const roundedConsumption = roundToNearest(usageItem.consumption, 2);
            usageItem.price = roundedConsumption * matchingRate.value_inc_vat;
            results.success.push({
                description: `Gas usage priced successfully`,
                interval_start: usageItem.interval_start,
                price: usageItem.price,
            });
        } else {
            usageItem.price = 0;
            results.failures.push({
                description: `No matching rate found for gas usage`,
                interval_start: usageItem.interval_start,
            });
        }

        return usageItem;
    });
}

// Main processPrices function
function processPrices(octopusData, results = { success: [], failures: [] }) {
    //console.log("DATA RECEIVED 2", octopusData);
    try {
        if (!octopusData || typeof octopusData !== 'object') {
            throw new Error('Invalid Octopus data provided for processing.');
        }

        const { electric_usage, electric_unit_rates, gas_usage, gas_unit_rates } = octopusData.data;

        if (!electric_usage || !electric_unit_rates) {
            results.failures.push({ description: 'Missing electric usage or rates data' });
        } else {
            octopusData.electric_usage = addPriceToUsage(electric_usage, electric_unit_rates, results);
        }

        if (!gas_usage || !gas_unit_rates) {
            results.failures.push({ description: 'Missing gas usage or rates data' });
        } else {
            octopusData.gas_usage = addPriceToUsageGas(gas_usage, gas_unit_rates, tariff.gas_conversion, results);
        }

        return octopusData;
    } catch (error) {
        results.failures.push({ description: 'Error in processPrices', error: error.message });
        throw error;
    }
}


// Export the module
module.exports = { processPrices };
