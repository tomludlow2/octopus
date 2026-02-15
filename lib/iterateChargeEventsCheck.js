const { Client } = require('pg');
const readline = require('readline');  // For reading user input
const processChargingEvent = require('./priceChargeEvent');
const dbConfig = require('../db_connect.json');
const Table = require('cli-table3'); // Import cli-table3

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function processUnprocessedEvents() {
    const client = new Client(dbConfig);
    const incorrectEntries = [];

    try {
        await client.connect();

        let rowNumber = 40;  // Starting row ID

        // Calculate the timestamp for 60 days ago
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        while (true) {
            // Fetch the specific charging event by row_number (id)
            const result = await client.query(`
                SELECT id, start_time, end_time, energy_used, estimated_cost, 
                       settled, percent_charged, ignore_event
                FROM charging_events
                WHERE id = $1 AND end_time >= $2
            `, [rowNumber, sixtyDaysAgo]);

            if (result.rows.length === 0) {
                console.log(`No more charging events found from ID ${rowNumber}.`);
                break;
            }

            const row = result.rows[0];
            const { id, start_time, end_time, energy_used, estimated_cost, settled, percent_charged, ignore_event } = row;

            // Format start_time and end_time for the table display
            const formattedStartTime = new Date(start_time).toLocaleString();
            const formattedEndTime = new Date(end_time).toLocaleString();

            // Initialize table for displaying event details
            const table = new Table({
                head: ['Event ID', 'Start Time', 'End Time', 'Energy Used (kWh)', 'Estimated Cost (GBP)', 
                    'Settled', 'Percent Charged', 'Ignore Event'],
                colWidths: [10, 25, 25, 18, 20, 12, 18, 14]
            });

            // Add the event data to the table
            table.push([id, formattedStartTime, formattedEndTime, energy_used || 'N/A', 
                        (estimated_cost / 100).toFixed(2) || 'N/A', 
                        settled ? 'Yes' : 'No', percent_charged || 'N/A', 
                        ignore_event ? 'Yes' : 'No']);

            console.log(table.toString());

            // Ask for confirmation about the correctness of the data
            await new Promise(resolve => {
                rl.question('Is this correct Y/N? ', async (answer) => {
                    if (answer.toUpperCase() === 'N') {
                        // Ask for a reason if marked as incorrect
                        rl.question('Please provide a reason for this incorrect entry: ', (reason) => {
                            incorrectEntries.push({
                                id,
                                start_time: formattedStartTime,
                                end_time: formattedEndTime,
                                energy_used: energy_used || 'N/A',
                                estimated_cost: (estimated_cost / 100).toFixed(2) || 'N/A',
                                settled: settled ? 'Yes' : 'No',
                                percent_charged: percent_charged || 'N/A',
                                ignore_event: ignore_event ? 'Yes' : 'No',
                                reason: reason || 'No reason provided'
                            });
                            resolve();
                        });
                    } else {
                        resolve();
                    }

                    // Move to the next event
                    rowNumber++;
                });
            });
        }

        // After all events, print a report of incorrect entries
        if (incorrectEntries.length > 0) {
            const incorrectTable = new Table({
                head: ['Event ID', 'Start Time', 'End Time', 'Energy Used (kWh)', 'Estimated Cost (GBP)', 
                    'Settled', 'Percent Charged', 'Ignore Event', 'Reason'],
                colWidths: [10, 25, 25, 18, 20, 12, 18, 14, 30]
            });

            incorrectEntries.forEach(entry => {
                incorrectTable.push([
                    entry.id, entry.start_time, entry.end_time, entry.energy_used, 
                    entry.estimated_cost, entry.settled, entry.percent_charged, entry.ignore_event, entry.reason
                ]);
            });

            console.log('Incorrect Entries:');
            console.log(incorrectTable.toString());
        } else {
            console.log('All events were correct.');
        }

    } catch (error) {
        console.error('Error processing charging events:', error);
    } finally {
        rl.close();
        await client.end();
    }
}

processUnprocessedEvents();
