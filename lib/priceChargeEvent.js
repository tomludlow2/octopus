const { Client } = require('pg');
const fs = require('fs');
const dbConfig = require('../db_connect.json');
const Table = require('cli-table3'); // Import cli-table3

async function processChargingEvent(row_number) {
    const client = new Client(dbConfig);
    const baselineDataPath = '../energy_baseline.json';
    const baselineData = JSON.parse(fs.readFileSync(baselineDataPath, 'utf8'));

    const baselineUsages = {};
    for (const timeKey in baselineData) {
        baselineUsages[timeKey] = baselineData[timeKey].median;
    }

    try {
        await client.connect();

        // Retrieve the specific charging event by row_number (id)
        const eventResult = await client.query(`
            SELECT id, start_time, end_time, percent_charged, energy_used, estimated_cost
            FROM charging_events 
            WHERE id = $1
        `, [row_number]);

        if (eventResult.rows.length === 0) {
            console.log(`No charging event found with id ${row_number}`);
            return;
        }

        const { id, start_time, end_time, percent_charged, energy_used, estimated_cost } = eventResult.rows[0];

        // Initialize tracking variables
        let sumResidualConsumption = 0;
        let sumResidualCost = 0;
        let validIntervalCount = 0;

        let intervalStart = roundDownToHourOrHalfHour(new Date(start_time));
        const intervalEnd = roundUpToHourOrHalfHour(new Date(end_time));

        // Loop through the time intervals and calculate consumption and cost
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

            if (parseFloat(residualCost) >= 5.0) {
                sumResidualConsumption += parseFloat(residualConsumption);
                sumResidualCost += parseFloat(residualCost);
                validIntervalCount += 1;
            }

            intervalStart = nextInterval;
        }

        const failInterval = validIntervalCount > 50;
        const failCost = sumResidualCost < 10.0;

        // Create a table for validation logs
        const table = new Table({
            head: ['Field', 'Value'],
            colWidths: [50, 20]
        });

        // Format the start_time and end_time into a readable format
        const formattedStartTime = new Date(start_time).toLocaleString();
        const formattedEndTime = new Date(end_time).toLocaleString();

        table.push(
            ['Charging Event ID', id],
            ['Start Time', formattedStartTime],
            ['End Time', formattedEndTime],
            ['Interval Count', validIntervalCount],
            ['Percent Charge', percent_charged],
            ['Sum of Residual Consumption (kWh)', sumResidualConsumption.toFixed(3)],
            ['Sum of Residual Cost (pence)', sumResidualCost.toFixed(3)],
            ['Intervals with Residual Cost >= 5.0', validIntervalCount],
            ['Fail Interval (more than 50 intervals)', failInterval ? 'Yes' : 'No'],
            ['Fail Cost (total residual cost < 10)', failCost ? 'Yes' : 'No']
        );

        console.log(table.toString());

        // Generate comment if the row fails validation
        let comment = '';
        if (failCost) {
            comment = `RPi: This row failed because of Cost - cost was too low`;
        } else if (failInterval) {
            comment = `RPi: This row failed because of Interval was too long ${validIntervalCount} intervals`;
        }

        // If the row fails validation, update the comment field in the database
        if (failCost || failInterval) {
            await client.query(`
                UPDATE charging_events
                SET comment = $1, ignore_event = true
                WHERE id = $2
            `, [comment, id]);

            console.log(`Charging event ID ${id} did not pass validation. Comment added: ${comment}`);
        } else {
            // If the tests pass, update the energy_used and estimated_cost fields
            await client.query(`
                UPDATE charging_events
                SET energy_used = $1, estimated_cost = $2, ignore_event = false
                WHERE id = $3
            `, [sumResidualConsumption.toFixed(3), sumResidualCost.toFixed(3), id]);

            console.log(`Charging event ID ${id} successfully updated with energy_used and estimated_cost.`);
        }

    } catch (error) {
        throw error; // Rethrow to indicate failure to the caller
    } finally {
        await client.end();
    }
}

// Helper function to round down to nearest hour or half-hour
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

// Helper function to round up to nearest hour or half-hour
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

module.exports = processChargingEvent;
