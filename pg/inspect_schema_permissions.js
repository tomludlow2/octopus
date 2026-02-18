const { Client } = require('pg');
const { loadDbConfig } = require('../lib/loadDbConfig');

async function inspectSchemaPermissions() {
    let dbConfig;

    try {
        dbConfig = loadDbConfig();
    } catch (error) {
        throw new Error(`DB config not found. Add db_connect.json or set DB_CONNECT_PATH. (${error.message})`);
    }

    const client = new Client(dbConfig);

    try {
        await client.connect();

        const identity = await client.query(`
            SELECT current_user,
                   current_database() AS database,
                   current_schema() AS schema,
                   current_setting('search_path') AS search_path;
        `);

        const schemaPrivileges = await client.query(`
            SELECT nspname AS schema_name,
                   has_schema_privilege(current_user, nspname, 'USAGE') AS can_usage,
                   has_schema_privilege(current_user, nspname, 'CREATE') AS can_create
            FROM pg_namespace
            WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
            ORDER BY nspname;
        `);

        const tableSummary = await client.query(`
            SELECT table_schema,
                   table_name,
                   string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) AS columns
            FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            GROUP BY table_schema, table_name
            ORDER BY table_schema, table_name;
        `);

        const tablePrivileges = await client.query(`
            SELECT table_schema,
                   table_name,
                   privilege_type
            FROM information_schema.table_privileges
            WHERE grantee = current_user
              AND table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name, privilege_type;
        `);

        console.log(JSON.stringify({
            identity: identity.rows[0],
            schema_privileges: schemaPrivileges.rows,
            tables: tableSummary.rows,
            table_privileges_for_current_user: tablePrivileges.rows
        }, null, 2));
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    inspectSchemaPermissions().catch((error) => {
        console.error('Failed to inspect schema permissions:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { inspectSchemaPermissions };
