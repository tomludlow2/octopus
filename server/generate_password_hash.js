const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
    console.error('Usage: node server/generate_password_hash.js "your-password"');
    process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');

console.log(JSON.stringify({ salt, passwordHash }, null, 2));
