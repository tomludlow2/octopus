const { Client } = require('pg');
const fs = require('fs');
const { format } = require('date-fns');
const dbConfig = require('../db_connect.json');

// Define excluded intervals
const excludedIntervals = [
    { date: '2024-09-03', start: '18:00', end: '23:59' },
    { date: '2024-09-04', start: '22:00', end: '23:59' },
    { date: '2024-09-05', start: '00:00', end: '23:59' },
    { date: '2024-09-06', start: '21:00', end: '23:59' },
    { date: '2024-09-07', start: '00:00', end: '06:00' },
    { date: '2024-09-08', start: '00:00', end: '23:59' },
    { date: '2024-09-09', start: '09:00', end: '15:00' },
    { date: '2024-09-12', start: '00:00', end: '05:00' },
    { date: '2024-09-15', start: '00:00', end: '05:00' },
    { date: '2024-09-17', start: '21:00', end: '23:59' },
    { date: '2024-09-18', start: '00:00', end: '05:00' },
    { date: '2024-09-20', start: '00:00', end: '05:00' },
    { date: '2024-09-26', start: '22:00', end: '23:59' },
    { date: '2024-09-27', start: '00:00', end: '05:00' },
    { date: '2024-09-28', start: '00:00', end: '05:00' },
    { date: '2024-09-30', start: '00:00', end: '05:00' },
    { date: '2024-10-01', start: '21:00', end: '23:59' },
    { date: '2024-10-02', start: '00:00', end: '05:00' },
    { date: '2024-10-04', start: '12:00', end: '15:00' },
    { date: '2024-10-06', start: '00:00', end: '05:00' },
    { date: '2024-10-08', start: '21:00', end: '23:59' },
    { date: '2024-10-09', start: '00:00', end: '06:00' },
    { date: '2024-10-10', start: '09:00', end: '15:00' },
    { date: '2024-10-10', start: '21:00', end: '23:59' },
    { date: '2024-10-12', start: '00:00', end: '06:00' },
    { date: '2024-10-14', start: '14:00', end: '16:00' },
    { date: '2024-10-16', start: '09:00', end: '14:00' },
    { date: '2024-10-18', start: '00:00', end: '23:59' },
    { date: '2024-10-19', start: '08:00', end: '09:00' },
    { date: '2024-10-20', start: '18:00', end: '23:59' },
    { date: '2024-10-22', start: '18:00', end: '23:59' },
    { date: '2024-10-23', start: '21:00', end: '23:59' },
    { date: '2024-10-24', start: '21:00', end: '23:59' },
    { date: '2024-10-25', start: '00:00', end: '05:00' },
    { date: '2024-10-26', start: '00:00', end: '23:59' },
    { date: '2024-10-28', start: '21:00', end: '22:00' },
    { date: '2024-10-29', start: '00:00', end: '05:00' },
    { date: '2024-10-30', start: '21:00', end: '23:59' },
    { date: '2024-10-31', start: '00:00', end: '05:00' },
    { date: '2024-10-17', start: '00:00', end: '23:59' },
    { date: '2024-10-21', start: '00:00', end: '23:59' }
];

// Check if a timestamp is in excluded intervals
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

async function calculateBaselineEnergyUsage() {
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

        const stats = {};
        for (const interval in intervalData) {
            const consumptions = intervalData[interval];
            const count = consumptions.length;

            const mean = consumptions.reduce((acc, val) => acc + val, 0) / count;
            const median = consumptions.sort((a, b) => a - b)[Math.floor(count / 2)];
            const variance = consumptions.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
            const standardError = Math.sqrt(variance / count);

            stats[interval] = {
                mean: mean.toFixed(3),
                median: median.toFixed(3),
                variance: variance.toFixed(3),
                standardError: standardError.toFixed(3),
            };
        }

        // Save JSON output
        fs.writeFileSync('../reports/energy_baseline_stats.json', JSON.stringify(stats, null, 2));
        console.log('Baseline energy usage statistics saved to ../reports/energy_baseline_stats.json');

        // Save CSV output
        const csvData = Object.entries(stats)
            .map(([interval, data]) => `${interval},${data.mean},${data.median},${data.variance},${data.standardError}`)
            .join('\n');

        fs.writeFileSync('../reports/energy_baseline_stats.csv', `Interval,Mean Consumption (kWh),Median Consumption (kWh),Variance,Standard Error\n${csvData}`);
        console.log('Baseline energy usage statistics saved to ../reports/energy_baseline_stats.csv');

    } catch (error) {
        console.error('Error calculating baseline energy usage:', error);
    } finally {
        await client.end();
    }
}

// Run the function
calculateBaselineEnergyUsage();
