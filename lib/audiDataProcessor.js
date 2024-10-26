const fs = require('fs');
const { Client } = require('pg');
const path = require('path');
const { format } = require('date-fns');
const insertChargeData = require('./chargeEventInsert'); // Import insertChargeData function

// Load sensitive database connection data
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

// Function to detect charging events based on user-defined logic
function detectChargingEvents(data) {
    const events = [];
    let inChargeEvent = false;

    // Loop through the sorted data to detect charging events
    data.forEach((entry, index) => {
        const currentState = parseFloat(entry.new_state);

        // Skip if the current state is invalid or NaN
        if (isNaN(currentState)) return;

        if (index > 0) {
            const previousState = parseFloat(data[index - 1].new_state);

            if (currentState <= previousState) {
                if (inChargeEvent) {
                    const lastEvent = events[events.length - 1];
                    lastEvent.end_time = data[index - 1].event_time;  
                    lastEvent.end_state = previousState.toString();   
                    inChargeEvent = false;
                }
            }

            if (currentState > previousState && !inChargeEvent) {
                inChargeEvent = true;

                events.push({
                    start_time: data[index - 1].event_time,
                    start_state: previousState.toString(),
                    end_time: null,
                    end_state: null
                });
            }
        }
    });

    return events;
}

// Function to sort data by event_time
function sortDataByEventTime(data) {
    return data.sort((a, b) => new Date(Date.parse(a.event_time)) - new Date(Date.parse(b.event_time)));
}

// Function to fetch data from PostgreSQL within a specified date range
async function fetchDataFromPostgres(start_time, end_time) {
    const client = new Client(dbConfig);
    await client.connect();

    try {
        const res = await client.query(
            `SELECT * FROM audi_events 
             WHERE entity_id = 'sensor.audi_q4_e_tron_state_of_charge'
             AND new_state != 'unavailable'
             AND event_time BETWEEN $1 AND $2
             ORDER BY event_time ASC`,
            [start_time, end_time]
        );
        return res.rows.map(row => ({
            entity_id: row.entity_id,
            new_state: row.new_state,
            event_time: new Date(Date.parse(row.event_time))
        }));
    } catch (error) {
        console.error('Error fetching data from PostgreSQL:', error);
        return [];
    } finally {
        await client.end();
    }
}

// Function to export data to CSV
function exportDataToCSV(data, prefix) {
    const headers = ['entity_id', 'new_state', 'event_time'];
    const csvData = [headers.join(','), ...data.map(event => [event.entity_id, event.new_state, event.event_time.toISOString()].join(','))].join('\n');
    const now = new Date();
    const csvFileName = `${prefix}_${format(now, 'yy_MM_dd_HH_mm')}.csv`;
    const csvFilePath = path.join(__dirname, '../reports', csvFileName);
    fs.writeFileSync(csvFilePath, csvData);
    console.log(`CSV file created at: ${csvFilePath}`);
}

// Function to save data to JSON
function exportDataToJSON(data, prefix) {
    const now = new Date();
    const jsonFileName = `${prefix}_${format(now, 'yy_MM_dd_HH_mm')}.json`;
    const jsonFilePath = path.join(__dirname, '../reports', jsonFileName);
    fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2));
    console.log(`JSON file created at: ${jsonFilePath}`);
}

// Exported function
module.exports = async function getChargingIntervals(start_time, end_time, debug = false) {
    // Step 1: Fetch data from PostgreSQL within the specified time range
    const data = await fetchDataFromPostgres(start_time, end_time);

    if (data.length === 0) {
        console.log('No data retrieved from the database.');
        return [];
    }

    // Step 2: Sort data by event_time
    const sortedData = sortDataByEventTime(data);

    // Step 3: Detect charging events
    const chargingEvents = detectChargingEvents(sortedData);

    if (debug) {
        // Step 4 (Debug mode): Export raw data and charging events to files
        exportDataToCSV(sortedData, 'audi_charge_interval');
        exportDataToJSON(chargingEvents, 'audi_charge_interval');
    }

    // Step 5: Insert detected charging events into the charging_events table
    for (const event of chargingEvents) {
        try {
            // Insert data using the chargeEventInsert function
            await insertChargeData([event]);
        } catch (error) {
            console.error(`Error inserting event with start_time ${event.start_time}:`, error.message);
        }
    }

    return chargingEvents;
};
