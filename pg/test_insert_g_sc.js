const fs = require('fs');
const { Client } = require('pg');

// Load database connection details from JSON file
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

// Function to insert standing charges
async function insertStandingCharges(standingCharges) {
    const client = new Client(dbConfig); // Create a new client
    await client.connect(); // Connect to the database

    const insertQuery = `
    INSERT INTO standing_charges (energy_type, price_pence, valid_from, valid_to)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (energy_type, valid_from)
    DO UPDATE SET 
        price_pence = EXCLUDED.price_pence, 
        valid_to = EXCLUDED.valid_to;
    `;

    try {
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
    } catch (error) {
        console.error('Error during insertion process:', error);
    } finally {
        await client.end(); // Ensure the client is closed
    }
}

// Sample data to insert
const standingChargeData = {
    electric_standing_charges: [
        {
            value_exc_vat: 62.26,
            value_inc_vat: 65.373,
            valid_from: "2024-03-31T23:00:00Z",
            valid_to: "2024-09-30T23:00:00Z",
            payment_method: null
        }
    ],
    gas_standing_charges: [
        {
            value_exc_vat: 28.09,
            value_inc_vat: 29.4945,
            valid_from: "2024-03-31T23:00:00Z",
            valid_to: "2024-09-30T23:00:00Z",
            payment_method: "DIRECT_DEBIT"
        }
    ]
};

// Call the function to insert data
insertStandingCharges(standingChargeData);
