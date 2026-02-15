const { Client } = require('pg');
const { loadDbConfig } = require('../lib/loadDbConfig');

const dbConfig = loadDbConfig();

// Sample electric consumption data
const electricData = [
    {
        consumption_kwh: 0.073,
        interval_start: "2024-09-10T01:00:00+01:00",
        interval_end: "2024-09-10T01:30:00+01:00",
        price_pence: 0.46669000000000005,
    },
    {
        consumption_kwh: 0.074,
        interval_start: "2024-09-10T01:30:00+01:00",
        interval_end: "2024-09-10T02:00:00+01:00",
        price_pence: 0.46669000000000005,
    },
    {
        consumption_kwh: 0.058,
        interval_start: "2024-09-10T02:00:00+01:00",
        interval_end: "2024-09-10T02:30:00+01:00",
        price_pence: 0.40002,
    },
    // Add more entries as needed
];

// Function to insert electric consumption data
async function insertElectricConsumption(data) {
    const client = new Client(dbConfig); // Create a new client

    const query = `
        INSERT INTO electric_consumption (consumption_kwh, price_pence, start_time, end_time)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (start_time)
        DO UPDATE SET 
            consumption_kwh = EXCLUDED.consumption_kwh, 
            price_pence = EXCLUDED.price_pence, 
            end_time = EXCLUDED.end_time;
    `;

    try {
        await client.connect(); // Connect to the database

        for (const item of data) {
            const values = [item.consumption_kwh, item.price_pence, item.interval_start, item.interval_end];

            try {
                await client.query(query, values); // Execute the query
            } catch (error) {
                // Handle unique constraint violation (error code 23505)
                if (error.code === '23505') {
                    console.error(`Duplicate entry for start_time ${item.interval_start}:`, error.detail);
                } else {
                    // Handle other errors
                    console.error('Error inserting electric consumption data:', error);
                }
            }
        }

        console.log('Electric consumption data inserted successfully');
    } catch (error) {
        console.error('Error during insertion process:', error);
    } finally {
        await client.end(); // Ensure the client is closed
    }
}

// Run the insertion function
insertElectricConsumption(electricData);
