const fs = require('fs');
const { Client } = require('pg');

// Load database connection details from JSON file
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

// Function to insert Audi event data
async function insertAudiEvent(eventData) {
    const client = new Client(dbConfig); // Create a new client

    const query = `
        INSERT INTO audi_events (entity_id, new_state, event_time)
            VALUES ($1, $2, $3)
            ON CONFLICT (entity_id, event_time)
            DO UPDATE SET 
                new_state = EXCLUDED.new_state;

    `;

    try {
        await client.connect(); // Connect to the database

        const values = [
            eventData.entity_id,
            eventData.state, // Adjust this line if you're still using the state string or JSON
            eventData.event_time // Adjust this line to use event_time or event_time
        ];
        console.log("EXAMPLE TIMESTAMP", eventData.event_time);

        await client.query(query, values); // Execute the query
        console.log('Audi event data inserted successfully.');
    } catch (error) {
        console.error('Error inserting audi event data:', error);
    } finally {
        await client.end(); // Ensure the client is closed
    }
}

// Export the function to make it reusable in other scripts
module.exports = {
    insertAudiEvent
};
