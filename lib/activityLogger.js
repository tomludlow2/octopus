const fs = require('fs');
const path = require('path');

function getLogPath(date = new Date()) {
    const day = date.toISOString().slice(0, 10);
    return path.join(__dirname, '../logs', `activity-${day}.log`);
}

function formatActivityLine(message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${String(message).replace(/[\r\n]+/g, ' ').trim()}`;
}

function appendActivityLog(message) {
    const targetPath = getLogPath();
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.appendFileSync(targetPath, `${formatActivityLine(message)}\n`, 'utf8');
}

module.exports = { appendActivityLog, getLogPath, formatActivityLine };
