#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mode = process.argv[2];
const skipRestart = process.argv.includes('--skip-restart');

if (!['enable', 'disable'].includes(mode)) {
    console.error('Usage: node scripts/toggle_codex_auth.js <enable|disable> [--skip-restart]');
    process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const serverDir = path.join(repoRoot, 'server');
const normalUsers = path.join(serverDir, 'web_users.json');
const codexUsers = path.join(serverDir, 'web_users_codex.json');
const activeUsersLink = path.join(serverDir, 'web_users_active.json');

if (!fs.existsSync(normalUsers)) {
    throw new Error(`Missing ${normalUsers}`);
}

if (!fs.existsSync(codexUsers)) {
    throw new Error(`Missing ${codexUsers}`);
}

const target = mode === 'enable' ? codexUsers : normalUsers;
if (fs.existsSync(activeUsersLink) || fs.lstatSync(path.dirname(activeUsersLink)).isDirectory()) {
    try {
        fs.unlinkSync(activeUsersLink);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}

fs.symlinkSync(path.basename(target), activeUsersLink);
console.log(`Set active auth users file to ${path.basename(target)} via ${activeUsersLink}`);

if (!skipRestart) {
    console.log('Restarting octopus_web_server service...');
    execSync('sudo systemctl restart octopus_web_server', { stdio: 'inherit' });
    console.log('Restart complete.');
} else {
    console.log('Skipping service restart (--skip-restart).');
}
