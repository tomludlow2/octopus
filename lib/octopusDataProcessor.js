const { importOctopusData } = require('./octopusImporter');

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
    } catch (err) {
        if (results) {
            results.failures.push({
                description: 'Critical failure in fetchProcessAndInsertOctopusData',
                timestamp: new Date().toISOString(),
                error: err.message || 'Unknown error'
            });
        }

        throw err;
    }
}

module.exports = { fetchProcessAndInsertOctopusData };
