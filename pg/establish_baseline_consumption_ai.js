const { Client } = require('pg');
const fs = require('fs');
const { format } = require('date-fns');
const dbConfig = require('../db_connect.json');

// Define previously excluded intervals
const excludedIntervals = [
    // Previously defined exclusions...
];

// Function to check if a timestamp is in excluded intervals
function isExcluded(timestamp) {
    const dateStr = format(timestamp, 'yyyy-MM-dd');
    const timeStr = format(timestamp, 'HH:mm');

    for (const { date, start, end } of excludedIntervals) {
        if (dateStr === date && timeStr >= start && timeStr <= end) {
            return true;
        }
    }
    return false;
}

async function calculateEnhancedBaselineEnergyUsage() {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        const startDate = '2024-09-01';
        const endDate = '2024-10-31';

        const result = await client.query(`
            SELECT date_trunc('minute', start_time) AS interval_start,
                   consumption_kwh
            FROM electric_consumption
            WHERE start_time >= $1
              AND start_time < $2
              AND NOT (
                  (date(start_time) = '2024-09-03' AND start_time::time >= '18:00')
                  OR (date(start_time) = '2024-09-04' AND start_time::time >= '22:00')
                  -- Add all conditions from excludedIntervals here
              )
            ORDER BY interval_start
        `, [startDate, endDate]);

        const intervalData = {};

        result.rows.forEach(row => {
            const interval = format(row.interval_start, 'HH:mm');
            if (!intervalData[interval]) intervalData[interval] = [];
            intervalData[interval].push(parseFloat(row.consumption_kwh));
        });

        // Calculate statistics with additional filtering
        const stats = {};
        for (const interval in intervalData) {
            const consumptions = intervalData[interval];

            // Filter out values that are considered "too high" (potential charging events)
            const filteredConsumptions = consumptions.filter(value => value < /* threshold value, e.g., */ 2.5);

            if (filteredConsumptions.length > 0) {
                const count = filteredConsumptions.length;

                const mean = filteredConsumptions.reduce((acc, val) => acc + val, 0) / count;
                const median = filteredConsumptions.sort((a, b) => a - b)[Math.floor(count / 2)];
                const variance = filteredConsumptions.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
                const standardError = Math.sqrt(variance / count);

                stats[interval] = {
                    mean: mean.toFixed(3),
                    median: median.toFixed(3),
                    variance: variance.toFixed(3),
                    standardError: standardError.toFixed(3),
                };
            }
        }

        // Save JSON output
        fs.writeFileSync('../reports/energy_baseline_stats_ai.json', JSON.stringify(stats, null, 2));
        console.log('Baseline energy usage statistics saved to ../reports/energy_baseline_stats_ai.json');

        // Save CSV output
        const csvData = Object.entries(stats)
            .map(([interval, data]) => `${interval},${data.mean},${data.median},${data.variance},${data.standardError}`)
            .join('\n');

        fs.writeFileSync('../reports/energy_baseline_stats_ai.csv', `Interval,Mean Consumption (kWh),Median Consumption (kWh),Variance,Standard Error\n${csvData}`);
        console.log('Baseline energy usage statistics saved to ../reports/energy_baseline_stats_ai.csv');

    } catch (error) {
        console.error('Error calculating enhanced baseline energy usage:', error);
    } finally {
        await client.end();
    }
}

// Run the function
calculateEnhancedBaselineEnergyUsage();
