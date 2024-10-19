const axios = require('axios');
const fs = require('fs');
const { Pool } = require('pg');

// Load sensitive database connection data
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

// Create a new PostgreSQL client
const pool = new Pool(dbConfig);

// Load IP and token from the config file
const config = JSON.parse(fs.readFileSync('./server_config.json', 'utf8'));
const ha_ip = config.ha_ip;
const token = config.token;

// Define the Audi Q4 e-tron charging related sensors
const audiChargingEntities = [
  'sensor.audi_q4_e_tron_charging_state',
  'sensor.audi_q4_e_tron_charging_mode',
  'sensor.audi_q4_e_tron_plug_state',
  'sensor.audi_q4_e_tron_external_power',
  'sensor.audi_q4_e_tron_charging_complete_time',
  'sensor.audi_q4_e_tron_state_of_charge'
];

// Function to fetch historical state data from Home Assistant
async function fetchAndPopulateOldAudiEvents() {
  try {
    // Set the start and end time for the history data
    const startTime = new Date('2023-01-01T00:00:00Z').toISOString();
    const endTime = new Date().toISOString();

    // Fetch history data for each entity
    for (const entity of audiChargingEntities) {
      const response = await axios.get(`https://${ha_ip}:8123/api/history/period/${startTime}?end_time=${endTime}&filter_entity_id=${entity}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const historyData = response.data[0]; // The first item contains the history for the entity

      // Loop through each state change and insert/update in the database
      for (const stateChange of historyData) {
        const { state, last_changed } = stateChange;

        // Prepare the data for insertion
        const audiEventData = {
          entity_id: entity,
          new_state: state, // Only storing the new state
          event_time: last_changed // Rename this to match your column name
        };

        // Insert into the database, updating on conflict
        await pool.query(`
          INSERT INTO audi_events (entity_id, new_state, event_time)
          VALUES ($1, $2, $3)
          ON CONFLICT (entity_id, event_time)
          DO UPDATE SET new_state = EXCLUDED.new_state
        `, [audiEventData.entity_id, audiEventData.new_state, audiEventData.event_time]);

        console.log(`Inserted/Updated data for entity ${entity} at ${last_changed}`);
        console.log("EXAMPLE OF TIME:",  audiEventData.event_time);
      }
    }
    console.log('Old Audi data populated and updated successfully!');
  } catch (error) {
    console.error('Error fetching or inserting data:', error);
  } finally {
    // Close the database connection
    await pool.end();
  }
}

// Run the function
fetchAndPopulateOldAudiEvents();
