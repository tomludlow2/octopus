const fs = require('fs');
const { Client } = require('pg');

// Load database connection details from JSON file
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

// Function to insert charging data into charging_events table
async function insertChargeData(chargeData) {
    const client = new Client(dbConfig);
    await client.connect();

    try {
        for (const event of chargeData) {
            const { start_time, end_time, start_state, end_state, estimated_cost, energy_used, settled = false } = event;

            // Check if end_time or end_state are null or undefined; skip if they are
            if (!end_time || end_state === null || end_state === undefined) {
                console.log(`Skipping incomplete event with start_time: ${start_time}`);
                continue;
            }

            // Calculate percent_charged
            const percent_charged = parseInt(end_state) - parseInt(start_state);

            // Check for existing entry with the same start_time or end_time
            const result = await client.query(
                `SELECT * FROM charging_events 
                 WHERE start_time = $1 OR end_time = $2`,
                [start_time, end_time]
            );

            // Handle existing entry
            if (result.rows.length > 0) {
                const existingEvent = result.rows[0];

                // Check if existing data should prevent insertion
                if (existingEvent.energy_used !== null || existingEvent.estimated_cost !== null || existingEvent.settled === true) {
                    throw new Error("Processed Data already inserted");
                }

                // Overwrite existing data if the entry is allowed to update
                await client.query(
                    `UPDATE charging_events
                     SET end_time = $1, energy_used = $2, estimated_cost = $3, percent_charged = $4, settled = $5, updated_at = NOW()
                     WHERE id = $6`,
                    [end_time, energy_used, estimated_cost, percent_charged, settled, existingEvent.id]
                );
                console.log(`Overwrote data for start_time: ${start_time}`);
            } else {
                // Insert new data if no duplicate exists
                await client.query(
                    `INSERT INTO charging_events (start_time, end_time, energy_used, estimated_cost, percent_charged, settled, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
                    [start_time, end_time, energy_used, estimated_cost, percent_charged, settled]
                );
                console.log(`Inserted new event with start_time: ${start_time}`);
            }
        }
    } catch (error) {
        console.error("Error inserting charging event data:", error.message);
    } finally {
        await client.end();
    }
}

module.exports = insertChargeData;
