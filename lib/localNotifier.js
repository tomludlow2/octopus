const axios = require('axios');

const DEFAULT_ENDPOINT = process.env.LOCAL_NOTIFY_ENDPOINT || 'http://localhost:55000/api/notify';

function validateNotificationInput(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('Notification payload must be an object.');
    }

    if (!input.title || typeof input.title !== 'string') {
        throw new Error('Notification title is required.');
    }

    if (!input.body || typeof input.body !== 'string') {
        throw new Error('Notification body is required.');
    }

    if (input.html && input.url) {
        throw new Error('Provide either html or url, not both.');
    }
}

async function sendNotification(input, options = {}) {
    validateNotificationInput(input);

    const endpoint = options.endpoint || DEFAULT_ENDPOINT;
    const timeoutMs = Number(options.timeoutMs || process.env.LOCAL_NOTIFY_TIMEOUT_MS || 5000);

    const payload = {
        title: input.title,
        body: input.body,
        sendNow: input.sendNow !== false
    };

    if (input.html) {
        payload.html = input.html;
    }

    if (input.url) {
        payload.url = input.url;
    }

    const response = await axios.post(endpoint, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: timeoutMs
    });

    return {
        endpoint,
        status: response.status,
        data: response.data,
        payload
    };
}

async function sendBasicHtmlNotification({ title, body, html }, options = {}) {
    return sendNotification({ title, body, html, sendNow: true }, options);
}

async function sendUrlNotification({ title, body, url }, options = {}) {
    return sendNotification({ title, body, url, sendNow: true }, options);
}


async function localErrorNotify(errorType, errorDescription, options = {}) {
    if (!errorType || !errorDescription) {
        throw new Error('localErrorNotify requires errorType and errorDescription.');
    }

    const body = `${errorType}: ${errorDescription}`;
    const htmlParts = [
        '<div>',
        '<h3>⚠️ Octopus Service Issue</h3>',
        `<p><strong>Type:</strong> ${String(errorType)}</p>`,
        `<p><strong>Description:</strong> ${String(errorDescription)}</p>`
    ];

    if (options.logFile) {
        htmlParts.push(`<p><strong>Log:</strong> ${String(options.logFile)}</p>`);
    }

    if (options.url) {
        htmlParts.push(`<p><a href="${String(options.url)}">Open diagnostic page</a></p>`);
    }

    htmlParts.push('</div>');

    return sendNotification({
        title: `Service Alert: ${errorType}`,
        body,
        html: htmlParts.join(''),
        sendNow: true
    }, options);
}

module.exports = {
    sendNotification,
    sendBasicHtmlNotification,
    sendUrlNotification,
    localErrorNotify
};
