const { Client } = require('pg');
const fs = require('fs');
const { format } = require('date-fns');
const dbConfig = require('../db_connect.json');

async function processIncompleteChargingEvents() {
    const client = new Client(dbConfig);
    const timestamp = format(new Date(), 'yy_MM_dd_HH_mm_ss');
    const pricingFilename = `../reports/pricing_report_${timestamp}.csv`;
    const validityFilename = `../reports/pricing_validity_report_${timestamp}.csv`;

    try {
        await client.connect();

        const baselineDataPath = '../energy_baseline.json';
        const baselineData = JSON.parse(fs.readFileSync(baselineDataPath, 'utf8'));

        const baselineUsages = {};
        for (const timeKey in baselineData) {
            baselineUsages[timeKey] = baselineData[timeKey].median;
        }

        const result = await client.query(`
            SELECT id, start_time, end_time 
            FROM charging_events 
            WHERE energy_used IS NULL OR estimated_cost IS NULL
        `);

        let csvContent = 'Row ID, Start Time, Interval Start, Interval End, Consumption (kWh), Baseline Consumption (kWh), Price per kWh, Residual Consumption (kWh), Residual Cost (pence)\n';
        let validityContent = 'Row ID, Start Time, End Time, Sum of Residual Consumption, Sum of Residual Cost, Intervals with Residual Cost < 5.0, fail_interval, fail_cost\n';

        for (const row of result.rows) {
            const { id, start_time, end_time } = row;

            let intervalStart = roundDownToHourOrHalfHour(new Date(start_time));
            const intervalEnd = roundUpToHourOrHalfHour(new Date(end_time));

            // Tracking totals and flags for the validity report
            let sumResidualConsumption = 0;
            let sumResidualCost = 0;
            let validIntervalCount = 0;

            while (intervalStart < intervalEnd) {
                const nextInterval = new Date(intervalStart);
                nextInterval.setMinutes(intervalStart.getMinutes() + 30);

                const consumptionResult = await client.query(`
                    SELECT SUM(consumption_kwh) AS interval_consumption, SUM(price_pence) AS interval_price
                    FROM electric_consumption
                    WHERE start_time >= $1 AND end_time <= $2
                `, [intervalStart, nextInterval]);

                const intervalConsumption = consumptionResult.rows[0].interval_consumption || 0;
                const intervalPrice = consumptionResult.rows[0].interval_price || 0;
                const pricePerKWh = intervalConsumption ? (intervalPrice / intervalConsumption).toFixed(3) : 0;

                const timeKey = intervalStart.toISOString().substring(11, 16);
                const baselineConsumption = baselineUsages[timeKey] || 0;
                const residualConsumption = (intervalConsumption - baselineConsumption).toFixed(3);
                const residualCost = (residualConsumption * pricePerKWh).toFixed(3);

                // Only include rows with residual_cost >= 5.0
                if (parseFloat(residualCost) >= 5.0) {
                    csvContent += `${id}, ${start_time.toISOString()}, ${intervalStart.toISOString()}, ${nextInterval.toISOString()}, ${intervalConsumption}, ${baselineConsumption}, ${pricePerKWh}, ${residualConsumption}, ${residualCost}\n`;

                    sumResidualConsumption += parseFloat(residualConsumption);
                    sumResidualCost += parseFloat(residualCost);
                    validIntervalCount += 1;
                }

                intervalStart = nextInterval;
            }

            // Determine fail_interval and fail_cost status
            const failInterval = validIntervalCount > 20;
            const failCost = sumResidualCost < 10.0;

            // Add row to the validity report
            validityContent += `${id}, ${start_time.toISOString()}, ${end_time.toISOString()}, ${sumResidualConsumption.toFixed(3)}, ${sumResidualCost.toFixed(3)}, ${validIntervalCount}, ${failInterval}, ${failCost}\n`;
        }

        // Write CSV contents to respective files
        fs.writeFileSync(pricingFilename, csvContent);
        console.log(`Pricing report saved to ${pricingFilename}`);

        fs.writeFileSync(validityFilename, validityContent);
        console.log(`Validity report saved to ${validityFilename}`);
    } catch (error) {
        console.error('Error processing charging events:', error);
    } finally {
        await client.end();
    }
}

function roundDownToHourOrHalfHour(date) {
    const minutes = date.getMinutes();
    date.setSeconds(0, 0);

    if (minutes < 30) {
        date.setMinutes(0);
    } else {
        date.setMinutes(30);
    }

    return date;
}

function roundUpToHourOrHalfHour(date) {
    const minutes = date.getMinutes();
    date.setSeconds(0, 0);

    if (minutes > 0 && minutes <= 30) {
        date.setMinutes(30);
    } else if (minutes > 30) {
        date.setMinutes(0);
        date.setHours(date.getHours() + 1);
    }

    return date;
}

processIncompleteChargingEvents();
