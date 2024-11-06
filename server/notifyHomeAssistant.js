// notifyHomeAssistant.js
const axios = require('axios');
const https = require('https');
const config = require('./server_config.json');

// Load IP and token
const ha_ip = config.ha_ip;
const token = config.token;

// Configure HTTPS agent to allow self-signed certificates, if needed
const agent = new https.Agent({ rejectUnauthorized: false });

async function sendNotification(message, title, data = {}) {
    try {
        const homeAssistantUrl = `https://${ha_ip}:8123/api/services/notify/notify`;

        await axios.post(
            homeAssistantUrl,
            {
                message,
                title,
                data
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                httpsAgent: agent,
                timeout: 10000
            }
        );

        console.log(`Notification sent: ${title} - ${message}`);
    } catch (error) {
        console.error('Failed to send notification to Home Assistant:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

// Notification Types

// 1. New Charge Complete Event Registered - with acknowledge action
async function notifyChargeComplete() {
    const message = "A new charge complete event has been registered.";
    const title = "Charge Complete";
    const data = {
        actions: [
            {
                action: "ACKNOWLEDGE",
                title: "Acknowledge"
            }
        ]
    };
    await sendNotification(message, title, data);
}

// 2. Octopus Data Successfully Fetched
async function notifyOctopusDataFetched() {
    const message = "Octopus data was successfully fetched.";
    const title = "Data Fetch Successful";
    await sendNotification(message, title);
}

// 6. Charge Event has been identified correctly
async function notifyChargeEventIdentified(dateTime, percentageCharged) {
    const formattedDate = new Date(dateTime).toLocaleString(); // Format the dateTime for readability
    const message = `A Charge Event has been identified successfully.\nDate/Time: ${formattedDate}\nPercentage Charged: ${percentageCharged}%`;
    const title = "Charge Event Identified";
    
    await sendNotification(message, title);
}


// notifyChargingEventPriced function with primary clickAction
async function notifyChargingEventPriced(dateTime, price, link) {
    const formattedDate = new Date(dateTime).toLocaleString(); // Format dateTime for readability
    const message = `Charging event on ${formattedDate} has been priced at £${price}.`;
    const title = "Charging Event Priced";
    const data = {
        clickAction: link // Set the primary click action as the main link
    };

    await sendNotification(message, title, data);
}

// 4. Charge Event Error
async function notifyChargeEventError(link) {
    const message = "There has been an error processing a charge event. Click to learn more";
    const title = "Charging Event Error";
    const data = {
        clickAction: link
    }
    await sendNotification(message, title, data);
}


// 5. Supervisor - Irregularity Received
async function notifySupervisorIrregularity() {
    const message = "Supervisor alert: An irregularity has been detected.";
    const title = "Supervisor Alert";
    const data = {
        actions: [
            {
                action: "INVESTIGATE",
                title: "Investigate"
            }
        ]
    };
    await sendNotification(message, title, data);
}

module.exports = {
    notifyChargeComplete,
    notifyOctopusDataFetched,
    notifyChargingEventPriced,
    notifyChargeEventError,
    notifySupervisorIrregularity,
    notifyChargeEventIdentified
};
