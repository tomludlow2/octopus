const { Client } = require('pg');
const { loadDbConfig } = require('../lib/loadDbConfig');

const dbConfig = loadDbConfig();

// Function to fetch and display standing charges
async function fetchStandingCharges() {
    const client = new Client(dbConfig);

    try {
        await client.connect(); // Connect to the database
        const fetchQuery = 'SELECT * FROM standing_charges';
        const res = await client.query(fetchQuery);
        
        console.log('Standing Charges Data:');
        console.log('-----------------------------------------------------');
        console.log('ID | Energy Type | Daily Charge (pence) | Valid From           | Valid To');
        console.log('-----------------------------------------------------');
        
        res.rows.forEach(row => {
            const dailyCharge = parseFloat(row.price_pence); // Convert to float
            console.log(`${row.id} | ${row.energy_type} | ${dailyCharge.toFixed(2)}              | ${row.valid_from} | ${row.valid_to}`);
        });
    } catch (error) {
        console.error('Error fetching data:', error);
    } finally {
        await client.end(); // Ensure client is closed
    }
}

// Call the function to fetch and display data
fetchStandingCharges();
