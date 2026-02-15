const fs = require('fs');
const { Client } = require('pg');
const path = require('path');
const { format } = require('date-fns');
const insertChargeData = require('./chargeEventInsert');

const { loadDbConfig } = require('./loadDbConfig');
const dbConfig = loadDbConfig();

// Function to detect charging events
function detectChargingEvents(data, results) {
    const events = [];
    let inChargeEvent = false;

    data.forEach((entry, index) => {
        const currentState = parseFloat(entry.new_state);

        if (isNaN(currentState)) return;

        if (index > 0) {
            const previousState = parseFloat(data[index - 1].new_state);

            if (currentState <= previousState && inChargeEvent) {
                const lastEvent = events[events.length - 1];
                lastEvent.end_time = data[index - 1].event_time;
                lastEvent.end_state = previousState.toString();
                inChargeEvent = false;
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

    results.data.chargingEvents = events;
    return events;
}

// Fetch data from PostgreSQL
async function fetchDataFromPostgres(start_time, end_time, results) {
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

        results.data.rawData = res.rows.map(row => ({
            entity_id: row.entity_id,
            new_state: row.new_state,
            event_time: new Date(Date.parse(row.event_time))
        }));

        return results.data.rawData;
    } catch (error) {
        console.error('Error fetching data from PostgreSQL:', error);
        results.failures.push({
            description: 'Error fetching data from PostgreSQL',
            timestamp: new Date().toISOString(),
            error: error.message
        });
        return [];
    } finally {
        await client.end();
    }
}

// Main processing function
module.exports = async function getChargingIntervals(start_time, end_time, results) {
    results.data = results.data || {};

    const data = await fetchDataFromPostgres(start_time, end_time, results);
    if (data.length === 0) {
        console.log('No data retrieved from the database.');
        return results;
    }

    const sortedData = data.sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
    detectChargingEvents(sortedData, results);

    for (const event of results.data.chargingEvents) {
        try {
            await insertChargeData([event]);
            results.success.push({ event, timestamp: new Date().toISOString() });
        } catch (error) {
            console.error(`Error inserting event:`, error.message);
            results.failures.push({ event, error: error.message });
        }
    }

    return results;
};
