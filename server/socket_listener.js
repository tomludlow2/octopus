const WebSocket = require('ws');
const fs = require('fs');
const { insertAudiEvent } = require('../lib/audiEventInsert'); // Import the function for inserting events
const { notifyChargeComplete } = require('./notifyHomeAssistant'); // Import the notification function

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

let ws;
let reconnectInterval = 5000; // Reconnect every 5 seconds if disconnected

// Function to establish WebSocket connection
function connect() {
  ws = new WebSocket(`wss://${ha_ip}:8123/api/websocket`);

  ws.on('open', () => {
    // Send authentication message
    ws.send(JSON.stringify({ type: 'auth', access_token: token }));
  });

  ws.on('message', (data) => {
    const response = JSON.parse(data);

    if (response.type === 'auth_ok') {
      // Subscribe to state changes
      ws.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }));
      console.log('Subscribed to state changes for Audi charging events.');
    } else if (response.event && response.event.event_type === 'state_changed') {
      const entityId = response.event.data.entity_id;

      // Check if the entity is related to Audi charging
      if (audiChargingEntities.includes(entityId)) {
        const newState = response.event.data.new_state.state; // Get the new state directly
        const lastChanged = response.event.data.new_state.last_changed;

        // Log the event
        console.log('Charging information change detected for:', entityId);
        console.log('New state:', newState);

        // Prepare the data for insertion
        const audiEventData = {
          entity_id: entityId,
          state: newState,
          event_time: lastChanged
        };

        // Insert the event into the database
        insertAudiEvent(audiEventData);

        // Check if the entity is the charging state and matches the specific condition
        if (entityId === 'sensor.audi_q4_e_tron_charging_state' && newState === 'chargePurposeReachedAndNotConservationCharging') {
          // Trigger the notification for a completed charge event
          notifyChargeComplete();
        }
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed. Attempting to reconnect...');
    reconnect();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    ws.close();
  });
}

// Function to handle reconnection
function reconnect() {
  setTimeout(() => {
    console.log('Reconnecting...');
    connect();
  }, reconnectInterval);
}

// Start the WebSocket connection
connect();
