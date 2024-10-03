const fs = require('fs');
const { Client } = require('pg');

// Load database connection details from JSON file
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

// Function to fetch and print Audi events data
async function fetchAudiEvents() {
    const client = new Client(dbConfig); // Create a new client

    try {
        await client.connect();
        const query = 'SELECT entity_id, new_state, event_time FROM audi_events ORDER BY event_time';
        const res = await client.query(query);

        console.log('Audi Events Data:');
        console.log('-----------------------------------------------------------');
        console.log('Entity ID                       | New State         | Event Time');
        console.log('-----------------------------------------------------------');
        
        res.rows.forEach(row => {
            const entityId = row.entity_id || 'N/A';
            const newState = row.new_state ? JSON.stringify(row.new_state) : 'N/A'; // Convert JSON to string
            const eventTime = row.event_time || 'N/A';

            console.log(`${entityId.padEnd(30)} | ${newState.padEnd(18)} | ${eventTime}`);
        });

        console.log('-----------------------------------------------------------');
    } catch (error) {
        console.error('Error fetching data:', error);
    } finally {
        await client.end();
    }
}

// Run the fetch function
fetchAudiEvents();
