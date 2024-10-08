const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Path to your CSV file
const csvFilePath = path.join(__dirname, '../reports/simulated_car_charge_data_7_days.csv');

// Array to store the parsed CSV data
let chargeData = [];

// Function to detect charging events
function detectChargingEvents(data) {
    const events = [];
    let chargeStart = null;
    let previousState = null;
    let inChargeEvent = false;

    // Loop through sorted data to detect charging events
    data.forEach((entry, index) => {
        const currentState = parseFloat(entry.new_state); // Parse the state of charge as a float

        // Skip if the current state is invalid or NaN
        if (isNaN(currentState)) return;

        if (!inChargeEvent) {
            // Detect when the SoC starts increasing (start of charge event)
            if (previousState !== null && currentState > previousState) {
                chargeStart = entry;  // Start charging
                inChargeEvent = true; // Mark that we're in a charge event
                // Store the previous state for start_state
                events.push({
                    start_time: chargeStart.event_time,
                    end_time: null, // Placeholder, will update later
                    start_state: previousState.toString(), // Correctly store the previous state before charging starts
                    end_state: null // Placeholder, will update later
                });
            }
        } else {
            // Detect when SoC reaches a high point (charge event ends)
            if (currentState < previousState || index === data.length - 1) {
                // Charging ends when the SoC decreases or it's the last entry
                const lastEvent = events[events.length - 1]; // Get the last charging event
                lastEvent.end_time = entry.event_time; // Update end_time
                lastEvent.end_state = previousState.toString(); // Update end_state

                // Reset for next charge cycle
                chargeStart = null;
                inChargeEvent = false;
            }
        }

        // Update the previous state of charge
        previousState = currentState;
    });

    return events;
}

// Function to sort data by event_time
function sortDataByEventTime(data) {
    return data.sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
}

// Read and parse the CSV file
fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
        // Assuming the CSV has 'entity_id', 'new_state', and 'event_time' columns
        chargeData.push(row);
    })
    .on('end', () => {
        // Sort the data by event_time before processing
        const sortedData = sortDataByEventTime(chargeData);

        // Now detect charging events in the sorted data
        const chargingEvents = detectChargingEvents(sortedData);

        // Output the results
        console.log('Detected Charging Events:', chargingEvents);

        // Optionally, write the detected events to a file
        fs.writeFileSync('./charging_events.json', JSON.stringify(chargingEvents, null, 2));
    });
