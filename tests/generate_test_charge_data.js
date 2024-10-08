const fs = require('fs');
const path = require('path');

// Utility to generate random numbers within a range
function getRandom(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Simulate charge/discharge events over 7 days
function generateCarStateData(startDate, days, eventsPerDay) {
    const data = [];
    let currentSoC = getRandom(50, 70); // Start with a random SoC between 50% and 70%
    const chargeEvents = 6; // Number of unique charging events
    const chargeDays = generateChargeDays(days, chargeEvents); // Pick random days for charging events
    let inCharging = false;

    for (let day = 0; day < days; day++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + day);

        for (let event = 0; event < eventsPerDay; event++) {
            const eventTime = new Date(date);
            eventTime.setHours(getRandom(6, 22)); // Limit events to daylight hours (6am to 10pm)
            eventTime.setMinutes(getRandom(0, 59));

            if (chargeDays.includes(day) && !inCharging && currentSoC <= 30) {
                // Start charging when we hit the low point (around 30%)
                inCharging = true;
            }

            if (inCharging) {
                // Simulate charging event
                currentSoC += getRandom(2, 5); // Charging increases SoC slowly
                if (currentSoC >= getRandom(79, 80)) {
                    currentSoC = 79 + getRandom(0, 1); // Cap the charge at 79 or 80%
                    inCharging = false; // Stop charging once a high point is reached
                }
            } else {
                // Simulate driving event (discharge)
                currentSoC -= getRandom(1, 3); // Driving decreases SoC
                if (currentSoC < 20) currentSoC = 20; // Don't let SoC drop below 20%
            }

            // Format the data as a CSV row
            data.push({
                entity_id: "sensor.audi_q4_e_tron_state_of_charge",
                event_time: eventTime.toISOString(),
                new_state: currentSoC.toString(),
            });
        }
    }
    return data;
}

// Helper to generate unique days for charging events
function generateChargeDays(days, chargeEvents) {
    const chargeDays = new Set();
    while (chargeDays.size < chargeEvents) {
        chargeDays.add(getRandom(0, days - 1)); // Pick random unique days for charging
    }
    return [...chargeDays];
}

// Write generated data to CSV
function writeToCSV(data, outputPath) {
    // Sort data by event_time
    data.sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

    const header = 'entity_id,event_time,new_state\n';
    const csvData = data.map(row => `${row.entity_id},${row.event_time},${row.new_state}`).join('\n');

    fs.writeFileSync(outputPath, header + csvData, 'utf8');
    console.log(`Generated CSV with ${data.length} rows at ${outputPath}`);
}

// Generate a 7-day dataset
const startDate = new Date('2024-09-01');
const days = 7;
const eventsPerDay = 12; // Reduced events per day to 12 (1 every 2 hours)

// Path to save the generated CSV
const outputPath = path.join(__dirname, '../reports/simulated_car_charge_data_7_days.csv');

// Generate the data
const simulatedData = generateCarStateData(startDate, days, eventsPerDay);

// Write the data to CSV file
writeToCSV(simulatedData, outputPath);
