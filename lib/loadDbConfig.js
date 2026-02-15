const fs = require('fs');
const path = require('path');

function loadDbConfig() {
    const candidatePaths = [
        process.env.DB_CONNECT_PATH,
        path.join(__dirname, '../db_connect.json'),
        path.join(process.cwd(), 'db_connect.json'),
        path.join(process.cwd(), '../db_connect.json')
    ].filter(Boolean);

    const resolvedPath = candidatePaths.find((candidate) => fs.existsSync(candidate));

    if (!resolvedPath) {
        throw new Error(
            `Missing database config file. Checked: ${candidatePaths.join(', ')}`
        );
    }

    return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

module.exports = { loadDbConfig };
