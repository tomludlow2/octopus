const { Client } = require('pg');
const { loadDbConfig } = require('../lib/loadDbConfig');

const dbConfig = loadDbConfig();

// Sample gas consumption data
const gasData = [
    {
        "consumption": 0,
        "interval_start": "2024-09-10T04:30:00+01:00",
        "interval_end": "2024-09-10T05:00:00+01:00",
        "price": 0
    },
    {
        "consumption": 0,
        "interval_start": "2024-09-10T05:00:00+01:00",
        "interval_end": "2024-09-10T05:30:00+01:00",
        "price": 0
    },
    {
        "consumption": 1.138,
        "interval_start": "2024-09-10T05:30:00+01:00",
        "interval_end": "2024-09-10T06:00:00+01:00",
        "price": 6.41
    },
];

// Function to insert gas consumption data
async function insertGasConsumption(gasData) {
    const client = new Client(dbConfig); // Create a new client

    const query = `
        INSERT INTO gas_consumption (consumption_kwh, price_pence, start_time, end_time)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (start_time)
        DO UPDATE SET 
            consumption_kwh = EXCLUDED.consumption_kwh, 
            price_pence = EXCLUDED.price_pence, 
            end_time = EXCLUDED.end_time;
    `;

    try {
        await client.connect(); // Connect to the database

        for (const gas of gasData) {
            const values = [gas.consumption, gas.price, gas.interval_start, gas.interval_end];

            try {
                await client.query(query, values); // Execute the query
            } catch (error) {
                // Handle unique constraint violation (error code 23505)
                if (error.code === '23505') {
                    console.error(`Duplicate entry for start_time ${gas.interval_start}:`, error.detail);
                } else {
                    // Handle other errors
                    console.error('Error inserting gas consumption data:', error);
                }
            }
        }

        console.log('Gas consumption data inserted successfully.');
    } catch (error) {
        console.error('Error during the insertion process:', error);
    } finally {
        await client.end(); // Ensure the client is closed
    }
}

// Run the insert function
insertGasConsumption(gasData);
