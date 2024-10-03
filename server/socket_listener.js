const WebSocket = require('ws');
const fs = require('fs');
const { insertAudiEvent } = require('../lib/audiEventInsert'); // Import the function for inserting events

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

// WebSocket connection URL
const ws = new WebSocket(`wss://${ha_ip}:8123/api/websocket`);

ws.on('open', () => {
  // Send authentication message
  ws.send(JSON.stringify({ type: 'auth', access_token: token }));

  // Listen for messages
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
        const newState = response.event.data.new_state;

        // Log the event
        console.log('Charging information change detected for:', entityId);
        console.log('New state:', newState);

        // Prepare the data for insertion
        const audiEventData = {
            entity_id: entityId,
            state: newState.state, // Directly assign the state descriptor
            event_time: newState.last_changed // Use last_changed as event_time
        };

        // Call the function to insert the event into the database
        insertAudiEvent(audiEventData);
      }
    }
  });
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
});

ws.on('close', () => {
  console.log('WebSocket connection closed.');
});
