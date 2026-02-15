const fs = require('fs');
const { Client } = require('pg');
const path = require('path');
const { format } = require('date-fns'); // For formatting dates

// Load sensitive database connection data
const { loadDbConfig } = require('./loadDbConfig');
const dbConfig = loadDbConfig();



// Function to detect charging events based on user-defined logic
function detectChargingEvents(data) {
    console.log("\nDATA\n", data, "\nDATA\n");
    const events = [];
    let inChargeEvent = false;

    // Loop through the sorted data to detect charging events
    data.forEach((entry, index) => {
        const currentState = parseFloat(entry.new_state); // Parse the state of charge as a float

        // Skip if the current state is invalid or NaN
        if (isNaN(currentState)) return;

        if (index > 0) {
            const previousState = parseFloat(data[index - 1].new_state);

            // If current state is less than or equal to previous, it marks the end of a charging event
            if (currentState <= previousState) {
                if (inChargeEvent) {
                    const lastEvent = events[events.length - 1];
                    lastEvent.end_time = data[index - 1].event_time;  // Correctly set end time to the previous entry's event_time
                    lastEvent.end_state = previousState.toString();    // Set end state to the previous entry's new_state
                    inChargeEvent = false;
                }
            }

            // If the current state is higher than the previous one, a charging event has started
            if (currentState > previousState && !inChargeEvent) {
                // Start a new charge event from the current entry
                inChargeEvent = true;

                let start_time_2 = data[index-1].event_time;
                events.push({
                    start_time: start_time_2,   // Use the current entry's event_time for the start time
                    start_state: previousState.toString(), // Correctly assign the previous state's charge level
                    end_time: null,  // Placeholder, will update later
                    end_state: null  // Placeholder, will update later
                });
            }
        }
    });

    return events;
}

// Function to sort data by event_time (parsing event_time correctly)
function sortDataByEventTime(data) {
    return data.sort((a, b) => new Date(Date.parse(a.event_time)) - new Date(Date.parse(b.event_time)));
}

// Function to fetch data from PostgreSQL, filtering by entity_id
async function fetchDataFromPostgres() {
    const client = new Client(dbConfig);
    await client.connect();

    try {
        // Fetch data from audi_events table where entity_id is 'sensor.audi_q4_e_tron_state_of_charge'
        const res = await client.query(
            `SELECT * FROM audi_events 
             WHERE entity_id = 'sensor.audi_q4_e_tron_state_of_charge'
             AND new_state != 'unavailable'
             ORDER BY event_time ASC`
        );
        return res.rows.map(row => ({
            entity_id: row.entity_id,
            new_state: row.new_state,
            event_time: new Date(Date.parse(row.event_time)) // Ensure event_time is a Date object
        }));
    } catch (error) {
        console.error('Error fetching data from PostgreSQL:', error);
        return [];
    } finally {
        await client.end();
    }
}

// Function to export raw data to CSV
function exportRawDataToCSV(data) {
    // Define CSV headers
    const headers = ['entity_id', 'new_state', 'event_time'];
    const csvData = [headers.join(','), ...data.map(event => [event.entity_id, event.new_state, event.event_time.toISOString()].join(','))].join('\n');

    // Define the output file path with current date and time
    const now = new Date();
    const csvFileName = `charging_events_${format(now, 'dd_MM_yy_HH_mm')}.csv`;
    const csvFilePath = path.join(__dirname, '../reports', csvFileName);

    // Write CSV data to file
    fs.writeFileSync(csvFilePath, csvData);
    console.log(`CSV file successfully created at: ${csvFilePath}`);
}

// Main function to execute the workflow
(async () => {
    // Step 1: Fetch data from PostgreSQL
    const data = await fetchDataFromPostgres();

    if (data.length === 0) {
        console.log('No data retrieved from the database.');
        return;
    }

    // Step 2: Sort data by event_time
    const sortedData = sortDataByEventTime(data);

    // Step 3: Detect charging events
    const chargingEvents = detectChargingEvents(sortedData);

    // Step 4: Save charging events to JSON file
    const now = new Date();
    const jsonFileName = `charging_events_${format(now, 'dd_MM_yy_HH_mm')}.json`;
    const jsonFilePath = path.join(__dirname, '../reports', jsonFileName);
    fs.writeFileSync(jsonFilePath, JSON.stringify(chargingEvents, null, 2));
    console.log('Charging events saved to JSON at:', jsonFilePath);

    // Step 5: Export raw data to CSV
    exportRawDataToCSV(sortedData);
})();
