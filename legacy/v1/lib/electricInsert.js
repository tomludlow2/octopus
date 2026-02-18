const { Client } = require('pg');
const { loadDbConfig } = require('../../../lib/loadDbConfig');

const dbConfig = loadDbConfig();

// Function to insert electric consumption data
async function insertElectricConsumption(electricData) {
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

        for (const electric of electricData) {
            const values = [electric.consumption, electric.price, electric.interval_start, electric.interval_end];

            try {
                await client.query(query, values); // Execute the query
            } catch (error) {
                // Handle unique constraint violation (error code 23505)
                if (error.code === '23505') {
                    console.error(`Duplicate entry for start_time ${electric.interval_start}:`, error.detail);
                } else {
                    // Handle other errors
                    console.error('Error inserting electric consumption data:', error);
                }
            }
        }

        console.log('Electric consumption data inserted successfully.');
        return {outcome:"success"};
    } catch (error) {
        console.error('Error during the insertion process:', error);
    } finally {
        await client.end(); // Ensure the client is closed
    }
}

// Export the function to make it reusable in other scripts
module.exports = {
    insertElectricConsumption
};
