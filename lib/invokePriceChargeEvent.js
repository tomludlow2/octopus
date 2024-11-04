// invokeNonIgnoredEvent.js
const { Client } = require('pg');
const processChargingEvent = require('./priceChargeEvent');
const dbConfig = require('../db_connect.json');

async function invokeNextNonIgnoredEvent() {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Find the first unprocessed charging event that isn't ignored
        const unprocessedResult = await client.query(`
            SELECT id 
            FROM charging_events 
            WHERE (energy_used IS NULL OR estimated_cost IS NULL) AND ignore_event = false
            ORDER BY start_time
            LIMIT 1
        `);

        if (unprocessedResult.rows.length === 0) {
            console.log('No unprocessed, non-ignored charging events found.');
            return;
        }

        const rowNumber = unprocessedResult.rows[0].id;
        console.log(`Processing non-ignored charging event with ID: ${rowNumber}`);

        // Call the module with the non-ignored row number
        await processChargingEvent(rowNumber);

    } catch (error) {
        console.error('Error finding non-ignored charging event:', error);
    } finally {
        await client.end();
    }
}

invokeNextNonIgnoredEvent();
