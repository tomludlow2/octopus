const { Client } = require('pg');
const { loadDbConfig } = require('./loadDbConfig');

const dbConfig = loadDbConfig();

// Function to insert electric consumption data
async function insertStandingCharges(standingCharges) {
    const client = new Client(dbConfig); // Create a new client

    const insertQuery = `
    INSERT INTO standing_charges (energy_type, price_pence, valid_from, valid_to)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (energy_type, valid_from)
    DO UPDATE SET 
        price_pence = EXCLUDED.price_pence, 
        valid_to = EXCLUDED.valid_to;
    `;

    try {
        await client.connect();
        
        for (const [key, charges] of Object.entries(standingCharges)) {
            const energyType = key.includes('electric') ? 'electric' : 'gas'; // Determine energy type from object title
            
            for (const charge of charges) {
                try {
                    await client.query(insertQuery, [
                        energyType,
                        charge.value_inc_vat,
                        charge.valid_from,
                        charge.valid_to
                    ]);
                } catch (error) {
                    // Handle unique constraint violation (error code 23505)
                    if (error.code === '23505') {
                        console.error(`Duplicate entry for ${energyType} on valid_from ${charge.valid_from}:`, error.detail);
                    } else {
                        // Handle other errors
                        console.error('Error inserting standing charge:', error);
                    }
                }
            }
        }
        console.log('Standing charges inserted successfully.');
        return {outcome:"success"};
    } catch (error) {
        console.error('Error during insertion process:', error);
    } finally {
        await client.end(); // Ensure the client is closed
    }
}

// Export the function to make it reusable in other scripts
module.exports = {
    insertStandingCharges
};
