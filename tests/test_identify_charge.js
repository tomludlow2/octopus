const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Path to your CSV file
const csvFilePath = path.join(__dirname, '../reports/charging_events_19_10_24_10_29.csv');

// Array to store the parsed CSV data
let chargeData = [];

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

// Read and parse the CSV file
fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
        // Assuming the CSV has 'entity_id', 'new_state', and 'event_time' columns
        const currentState = parseFloat(row.new_state); // Parse the state as float
        const eventTime = new Date(Date.parse(row.event_time)); // Parse event_time more robustly

        if (!isNaN(currentState)) {  // Filter out non-numeric values
            chargeData.push({
                ...row,
                event_time: eventTime // Store the parsed Date object
            });
        }
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
