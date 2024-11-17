const fs = require('fs');
const { Client } = require('pg');

// Load database connection details from JSON file
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

// Function to insert gas consumption data
async function insertGasConsumption(gasData) {
    //console.log("DATA:", gasData);
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
        return {outcome:"success"};
    } catch (error) {
        console.error('Error during the insertion process:', error);
    } finally {
        await client.end(); // Ensure the client is closed
    }
}

// Export the function to make it reusable in other scripts
module.exports = {
    insertGasConsumption
};
