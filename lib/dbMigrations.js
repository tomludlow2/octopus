const fs = require('fs');
const path = require('path');

async function runMigrations(client) {
    const migrationsDir = path.join(__dirname, '../migrations');

    if (!fs.existsSync(migrationsDir)) {
        return;
    }

    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    const files = fs.readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();

    for (const file of files) {
        const version = path.basename(file);
        const alreadyApplied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);

        if (alreadyApplied.rowCount > 0) {
            continue;
        }

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

        await client.query('BEGIN');
        try {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    }
}

module.exports = { runMigrations };
