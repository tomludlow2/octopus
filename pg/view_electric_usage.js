const { Client } = require('pg');
const { loadDbConfig } = require('../lib/loadDbConfig');

const dbConfig = loadDbConfig();

// Function to fetch and print electric consumption data
async function fetchElectricConsumption() {
    const client = new Client(dbConfig); // Create a new client

    try {
        await client.connect();
        const query = 'SELECT consumption_kwh, price_pence, start_time, end_time FROM electric_consumption ORDER BY start_time';
        const res = await client.query(query);

        console.log('Electric Consumption Data:');
        console.log('-----------------------------------------------------------');
        console.log('Consumption (kWh) | Price (pence) | Start Time              | End Time');
        console.log('-----------------------------------------------------------');
        
        res.rows.forEach(row => {
            const consumption = parseFloat(row.consumption_kwh) || 0;
            const price = parseFloat(row.price_pence) || 0;

            console.log(`${consumption.toFixed(3).padEnd(20)} | ${price.toFixed(2).padEnd(14)} | ${row.start_time} | ${row.end_time}`);
        });

        console.log('-----------------------------------------------------------');
    } catch (error) {
        console.error('Error fetching data:', error);
    } finally {
        await client.end();
    }
}

// Run the fetch function
fetchElectricConsumption();
