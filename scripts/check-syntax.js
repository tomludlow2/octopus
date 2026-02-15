const { execSync } = require('child_process');
const { readdirSync, statSync } = require('fs');
const { join } = require('path');

function collectJsFiles(dir) {
    const entries = readdirSync(dir);
    const files = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
            files.push(...collectJsFiles(fullPath));
        } else if (entry.endsWith('.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

const targetDirs = ['lib', 'pg', 'server', 'tests'];
const jsFiles = targetDirs.flatMap((dir) => collectJsFiles(dir));

let failed = false;

for (const file of jsFiles) {
    try {
        execSync(`node --check ${file}`, { stdio: 'pipe' });
    } catch (error) {
        failed = true;
        process.stderr.write(`Syntax check failed for ${file}\n`);
        if (error.stderr) {
            process.stderr.write(error.stderr.toString());
        }
    }
}

if (failed) {
    process.exitCode = 1;
} else {
    console.log(`Syntax check passed for ${jsFiles.length} JavaScript files.`);
}
