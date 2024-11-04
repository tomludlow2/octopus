// processChargingEvent.js
const { Client } = require('pg');
const fs = require('fs');
const dbConfig = require('../db_connect.json');

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
            SELECT id, start_time, end_time 
            FROM charging_events 
            WHERE id = $1
        `, [row_number]);

        if (eventResult.rows.length === 0) {
            console.log(`No charging event found with id ${row_number}`);
            return;
        }

        const { id, start_time, end_time } = eventResult.rows[0];

        // Initialize tracking variables
        let sumResidualConsumption = 0;
        let sumResidualCost = 0;
        let validIntervalCount = 0;

        let intervalStart = roundDownToHourOrHalfHour(new Date(start_time));
        const intervalEnd = roundUpToHourOrHalfHour(new Date(end_time));

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

        const failInterval = validIntervalCount > 20;
        const failCost = sumResidualCost < 10.0;

        console.log(`Charging Event ID: ${id}`);
        console.log(`Start Time: ${start_time}`);
        console.log(`End Time: ${end_time}`);
        console.log(`Sum of Residual Consumption: ${sumResidualConsumption.toFixed(3)} kWh`);
        console.log(`Sum of Residual Cost: ${sumResidualCost.toFixed(3)} pence`);
        console.log(`Intervals with Residual Cost >= 5.0: ${validIntervalCount}`);
        console.log(`Fail Interval (more than 20 intervals): ${failInterval}`);
        console.log(`Fail Cost (total residual cost < 10): ${failCost}`);

        // If both tests pass, update energy_used and estimated_cost
        if (!failInterval && !failCost) {
            await client.query(`
                UPDATE charging_events
                SET energy_used = $1, estimated_cost = $2, ignore_event = false
                WHERE id = $3
            `, [sumResidualConsumption.toFixed(3), sumResidualCost.toFixed(3), id]);

            console.log(`Charging event ID ${id} successfully updated with energy_used and estimated_cost.`);
        } else {
            // If any test fails, mark the event as ignored
            await client.query(`
                UPDATE charging_events
                SET ignore_event = true
                WHERE id = $1
            `, [id]);

            console.log(`Charging event ID ${id} did not pass the tests and has been marked as ignored.`);
        }

    } catch (error) {
        console.error('Error processing charging event:', error);
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
