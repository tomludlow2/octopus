const fs = require('fs');
const { Client } = require('pg');

// Load database connection details from JSON file
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

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

    try {
        await client.connect();
        for (const item of data) {
            const query = `
                INSERT INTO electric_consumption (consumption_kwh, price_pence, start_time, end_time)
                VALUES ($1, $2, $3, $4)
            `;
            const values = [item.consumption_kwh, item.price_pence, item.interval_start, item.interval_end];
            await client.query(query, values);
        }
        console.log('Electric consumption data inserted successfully');
    } catch (error) {
        console.error('Error inserting data:', error);
    } finally {
        await client.end();
    }
}

// Run the insertion function
insertElectricConsumption(electricData);
