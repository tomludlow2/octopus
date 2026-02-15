const fs = require('fs');
const { Client } = require('pg');


const { loadDbConfig } = require('../lib/loadDbConfig');
const dbConfig = loadDbConfig();


// Standalone function to fetch and display gas cost data for the last 14 days
async function displayGasCostLast14Days() {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Query to get the total gas cost for each of the last 14 days
        const query = `
            SELECT 
                DATE(start_time) AS date,
                SUM(price_pence) AS gas_cost
            FROM gas_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '14 DAY'
            GROUP BY DATE(start_time)
            ORDER BY DATE(start_time) DESC;
        `;

        const res = await client.query(query);

        // Check if data is available
        if (res.rowCount === 0) {
            console.log('No data available for the last 14 days.');
            return;
        }

        // Print header
        console.log("Date       | Gas Cost (£)");
        console.log("-------------------------");

        // Print each day's data in the table format
        res.rows.forEach(row => {
            const formattedDate = row.date;  // Format the date as needed
            const gasCost = (row.gas_cost / 100).toFixed(2);  // Convert to pounds
            console.log(`${formattedDate} | £${gasCost.padStart(8)}`);
        });

    } catch (error) {
        console.error('Error fetching data:', error);
    } finally {
        await client.end();
    }
}

// Call the function to display the gas costs
displayGasCostLast14Days();

// Standalone function to fetch and display gas cost data for the last 14 days
async function displayElectricCostLast14Days() {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Query to get the total gas cost for each of the last 14 days
        const query = `
            SELECT 
                DATE(start_time) AS date,
                SUM(price_pence) AS electric_cost
            FROM electric_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '14 DAY'
            GROUP BY DATE(start_time)
            ORDER BY DATE(start_time) DESC;
        `;

        const res = await client.query(query);

        // Check if data is available
        if (res.rowCount === 0) {
            console.log('No data available for the last 14 days.');
            return;
        }

        // Print header
        console.log("Date       | electric Cost (£)");
        console.log("-------------------------");

        // Print each day's data in the table format
        res.rows.forEach(row => {
            const formattedDate = row.date;  // Format the date as needed
            const electricCost = (row.electric_cost / 100).toFixed(2);  // Convert to pounds
            console.log(`${formattedDate} | £${electricCost.padStart(8)}`);
        });

    } catch (error) {
        console.error('Error fetching data:', error);
    } finally {
        await client.end();
    }
}

// Call the function to display the gas costs
displayElectricCostLast14Days();
// Standalone function to fetch and display combined gas and electric cost data for the last 14 days
async function displayLast14DaysCosts() {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Query to get the total gas cost for each of the last 14 days
        const gasQuery = `
            SELECT 
                DATE(start_time) AS date,
                SUM(price_pence) AS gas_cost
            FROM gas_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '14 DAY'
            GROUP BY DATE(start_time)
            ORDER BY DATE(start_time) DESC;
        `;

        const electricQuery = `
            SELECT 
                DATE(start_time) AS date,
                SUM(price_pence) AS electric_cost
            FROM electric_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '14 DAY'
            GROUP BY DATE(start_time)
            ORDER BY DATE(start_time) DESC;
        `;

        const gasRes = await client.query(gasQuery);
        const electricRes = await client.query(electricQuery);

        // Check if data is available
        if (gasRes.rowCount === 0 || electricRes.rowCount === 0) {
            console.log('No data available for the last 14 days.');
            return;
        }

        // Merge the results from both queries
        const mergedResults = [];
        const maxLength = Math.max(gasRes.rowCount, electricRes.rowCount);

        for (let i = 0; i < maxLength; i++) {
            const gasRow = gasRes.rows[i] || { date: null, gas_cost: 0 };  // If no data for a specific day
            const electricRow = electricRes.rows[i] || { date: null, electric_cost: 0 };  // If no data for a specific day
            
            mergedResults.push({
                date: gasRow.date || electricRow.date,  // Use the date from either table
                gas_cost: (gasRow.gas_cost / 100).toFixed(2),  // Convert to pounds
                electric_cost: (electricRow.electric_cost / 100).toFixed(2)  // Convert to pounds
            });
        }

        // Print header
        console.log("Date       | Gas Cost (£) | Electric Cost (£)");
        console.log("------------------------------------------------");

        // Print each day's data in the table format
        mergedResults.forEach(row => {
            console.log(`${row.date} | £${row.gas_cost.padStart(11)} | £${row.electric_cost.padStart(14)}`);
        });

    } catch (error) {
        console.error('Error fetching data:', error);
    } finally {
        await client.end();
    }
}

// Call the function to display the combined gas and electric costs
displayLast14DaysCosts();