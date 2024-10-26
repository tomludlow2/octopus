const fs = require('fs');
const { Client } = require('pg');

// Load database connection details from JSON file
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

// Function to fetch and print charging events data
async function fetchChargingEvents() {
    const client = new Client(dbConfig);

    try {
        await client.connect();
        const query = `
            SELECT start_time, end_time, energy_used, estimated_cost, percent_charged, settled
            FROM charging_events
            ORDER BY start_time;
        `;
        const res = await client.query(query);

        console.log('Charging Events Data:');
        console.log('-----------------------------------------------------------------------------------------');
        console.log('Start Time               | End Time                 | Energy Used | Estimated Cost | Percent Charged | Settled');
        console.log('-----------------------------------------------------------------------------------------');
        
        res.rows.forEach(row => {
            const startTime = row.start_time || 'N/A';
            const endTime = row.end_time || 'N/A';
            const energyUsed = row.energy_used !== null ? row.energy_used.toFixed(2) : 'N/A';
            const estimatedCost = row.estimated_cost !== null ? `£${row.estimated_cost.toFixed(2)}` : 'N/A';
            const percentCharged = row.percent_charged !== null ? row.percent_charged : 'N/A';
            const settled = row.settled ? 'True' : 'False';

            console.log(`${startTime} | ${endTime} | ${energyUsed.toString().padEnd(11)} | ${estimatedCost.padEnd(14)} | ${percentCharged.toString().padEnd(15)} | ${settled}`);
        });

        console.log('-----------------------------------------------------------------------------------------');
    } catch (error) {
        console.error('Error fetching charging events data:', error);
    } finally {
        await client.end();
    }
}

// Run the fetch function
fetchChargingEvents();
