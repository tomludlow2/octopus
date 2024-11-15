const { Client } = require('pg');
const processChargingEvent = require('./priceChargeEvent');
const dbConfig = require('../db_connect.json');
const { notifyChargingEventPriced, notifyChargeEventError } = require('../server/notifyHomeAssistant'); // Import notification functions

async function processUnprocessedEvents() {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Fetch the latest end_time from electric_consumption
        const result = await client.query(`
            SELECT MAX(end_time) as latest_time
            FROM electric_consumption
        `);
        const latestTime = result.rows[0]?.latest_time;

        if (!latestTime) {
            console.log('No data available in electric_consumption table.');
            return;
        }

        // Find all unprocessed charging events that aren't ignored
        const unprocessedResult = await client.query(`
            SELECT id, start_time, end_time
            FROM charging_events
            WHERE (energy_used IS NULL OR estimated_cost IS NULL)
              AND ignore_event = false
              AND end_time <= $1
            ORDER BY start_time
        `, [latestTime]);

        if (unprocessedResult.rows.length === 0) {
            console.log('No unprocessed, non-ignored charging events found.');
            return;
        }

        // Iterate through each unprocessed event
        for (const row of unprocessedResult.rows) {
            const rowNumber = row.id;
            const eventDate = row.start_time.toISOString().split('T')[0];
            const successLink = `http://192.168.68.78:52529/view_charge_event/${rowNumber}`;
            const errorLink = `http://192.168.68.78:52529/view_charge_event_error/${rowNumber}`;

            console.log(`Processing non-ignored charging event with ID: ${rowNumber}`);

            try {
                // Process the charging event
                const result = await processChargingEvent(rowNumber);

                // Assume processChargingEvent returns an object with dateTime and price on success
                const { dateTime, price } = result;

                // Notify success with dateTime and price
                await notifyChargingEventPriced(dateTime, price, successLink);
                console.log(`Charge Event ${rowNumber} processed successfully.`);
            } catch (error) {
                console.error(`Error processing Charge Event ID ${rowNumber}:`, error);

                // Notify failure and link to error-specific view
                await notifyChargeEventError(errorLink);
            }
        }
    } catch (error) {
        console.error('Error finding unprocessed, non-ignored charging events:', error);
    } finally {
        await client.end();
    }
}

processUnprocessedEvents();
