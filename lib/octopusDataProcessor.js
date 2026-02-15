const { importOctopusData } = require('./octopusImporter');
const { getOctopusData } = require('./getOctopusData');
const { processPrices } = require('./processPrices');
const { insertGasConsumption } = require('./gasInsert');
const { insertElectricConsumption } = require('./electricInsert');
const { insertStandingCharges } = require('./standingChargeInsert');
const { appendActivityLog } = require('./activityLogger');

function hasTime(date) {
    return date.includes('T');
}

function isPermissionCompatibilityError(error) {
    if (!error) {
        return false;
    }

    const text = `${error.message || ''}`.toLowerCase();
    return error.code === '42501'
        || text.includes('permission denied for schema public')
        || text.includes('permission denied');
}

async function runLegacyPipeline(startDate, endDate, results) {
    const startPeriod = hasTime(startDate) ? startDate : `${startDate}T00:00:00Z`;
    const endPeriod = hasTime(endDate) ? endDate : `${endDate}T00:00:00Z`;

    const octopusData = await getOctopusData(startPeriod, endPeriod);
    const processedData = processPrices(octopusData, results);

    results.data.processed_data = processedData;

    await insertGasConsumption(processedData.data.gas_usage || []);
    await insertElectricConsumption(processedData.data.electric_usage || []);

    const scData = {
        electric_standing_charges: processedData.data.electric_standing_charges || [],
        gas_standing_charges: processedData.data.gas_standing_charges || []
    };

    await insertStandingCharges(scData);

    return {
        compatibility_mode: true,
        period: { start: startPeriod, end: endPeriod },
        reason: 'fallback_legacy_pipeline'
    };
}

async function fetchProcessAndInsertOctopusData(startDate, endDate, results) {
    try {
        const summary = await importOctopusData(startDate, endDate, {
            reason: results?.metadata?.reason || 'manual run'
        });

        if (results) {
            results.data.import_summary = summary;
            results.success.push({ description: 'Octopus data import completed', summary });
        }

        return summary;
    } catch (error) {
        if (!isPermissionCompatibilityError(error)) {
            if (results) {
                results.failures.push({
                    description: 'Critical failure in fetchProcessAndInsertOctopusData',
                    timestamp: new Date().toISOString(),
                    error: error.message || 'Unknown error'
                });
            }

            throw error;
        }

        const fallbackSummary = await runLegacyPipeline(startDate, endDate, results);
        appendActivityLog(`Importer compatibility fallback used for ${startDate}..${endDate}; reason=${error.message}`);

        if (results) {
            results.success.push({
                description: 'Imported data using compatibility mode (legacy pipeline)',
                reason: error.message,
                summary: fallbackSummary
            });
        }

        return fallbackSummary;
    }
}

module.exports = { fetchProcessAndInsertOctopusData, runLegacyPipeline, isPermissionCompatibilityError };
