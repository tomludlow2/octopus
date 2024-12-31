const { Client } = require('pg');
const processChargingEvent = require('./priceChargeEvent');
const dbConfig = require('../db_connect.json');
const Table = require('cli-table3'); // Import cli-table3

async function processChargingEvents() {
    const client = new Client(dbConfig);
    const incorrectEntries = [];

    try {
        await client.connect();

        // Fetch all charging events from the table
        const result = await client.query(`
            SELECT id, start_time, end_time, energy_used, estimated_cost, 
                   settled, percent_charged, ignore_event
            FROM charging_events
            ORDER BY start_time
        `);

        for (const row of result.rows) {
            const { id, start_time, end_time, energy_used, estimated_cost, settled, percent_charged, ignore_event } = row;

            // Format start_time and end_time for the table display
            const formattedStartTime = new Date(start_time).toLocaleString();
            const formattedEndTime = new Date(end_time).toLocaleString();

            // Initialize table for displaying event details
            const table = new Table({
                head: ['Event ID', 'Start Time', 'End Time', 'Energy Used (kWh)', 'Estimated Cost (GBP)', 
                    'Settled', 'Percent Charged', 'Ignore Event'],
                colWidths: [10, 25, 25, 18, 20, 12, 18, 14]
            });

            // Add the event data to the table
            table.push([id, formattedStartTime, formattedEndTime, energy_used || 'N/A', 
                        (estimated_cost / 100).toFixed(2) || 'N/A', 
                        settled ? 'Yes' : 'No', percent_charged || 'N/A', 
                        ignore_event ? 'Yes' : 'No']);

            console.log(table.toString());

            // Call the processChargingEvent function for each entry with the row data
            try {
                const processResult = await processChargingEvent(id);
                console.log(`Charging event ID ${id} processed successfully with result:`, processResult);
            } catch (error) {
                console.error(`Error processing Charge Event ID ${id}:`, error);

                // Check for missing or incorrect data and save to incorrectEntries
                if (energy_used === null || estimated_cost === null || percent_charged === null) {
                    incorrectEntries.push({
                        id,
                        start_time: formattedStartTime,
                        end_time: formattedEndTime,
                        energy_used: energy_used || 'N/A',
                        estimated_cost: (estimated_cost / 100).toFixed(2) || 'N/A',
                        settled: settled ? 'Yes' : 'No',
                        percent_charged: percent_charged || 'N/A',
                        ignore_event: ignore_event ? 'Yes' : 'No',
                        reason: 'Missing or incorrect data'
                    });
                }
            }
        }

        // After all events, print a report of incorrect entries
        if (incorrectEntries.length > 0) {
            const incorrectTable = new Table({
                head: ['Event ID', 'Start Time', 'End Time', 'Energy Used (kWh)', 'Estimated Cost (GBP)', 
                    'Settled', 'Percent Charged', 'Ignore Event', 'Reason'],
                colWidths: [10, 25, 25, 18, 20, 12, 18, 14, 30]
            });

            incorrectEntries.forEach(entry => {
                incorrectTable.push([entry.id, entry.start_time, entry.end_time, entry.energy_used, 
                    entry.estimated_cost, entry.settled, entry.percent_charged, entry.ignore_event, entry.reason]);
            });

            console.log('Incorrect Entries:');
            console.log(incorrectTable.toString());
        } else {
            console.log('All events were correct.');
        }

    } catch (error) {
        console.error('Error processing charging events:', error);
    } finally {
        await client.end();
    }
}

processChargingEvents();
