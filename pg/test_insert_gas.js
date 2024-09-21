const fs = require('fs');
const { Client } = require('pg');

// Load database connection details from JSON file
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

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
async function insertGasConsumption() {
    const client = new Client(dbConfig); // Create a new client

    try {
        await client.connect();

        for (const gas of gasData) {
            const query = `
                INSERT INTO gas_consumption (consumption_kwh, price_pence, start_time, end_time)
                VALUES ($1, $2, $3, $4)
            `;
            const values = [gas.consumption, gas.price, gas.interval_start, gas.interval_end];
            await client.query(query, values);
        }

        console.log('Gas consumption data inserted successfully.');
    } catch (error) {
        console.error('Error inserting data:', error);
    } finally {
        await client.end();
    }
}

// Run the insert function
insertGasConsumption();
