const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

// ---- Load DB config from db_connect.json ----
const configPath = path.join(__dirname, "../db_connect.json");
if (!fs.existsSync(configPath)) {
  console.error("❌ db_connect.json not found");
  process.exit(1);
}

const dbConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

// ---- Connect to Postgres ----
const client = new Client(dbConfig);

async function main() {
  await client.connect();
  console.log("✅ Connected to database:", dbConfig.database);

  // Exclude system schemas
  const tablesRes = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type='BASE TABLE'
      AND table_schema NOT IN ('pg_catalog','information_schema')
      AND table_schema NOT LIKE 'pg_toast%'
      AND table_schema NOT LIKE 'pg_temp_%'
    ORDER BY table_schema, table_name;
  `);

  for (const { table_schema, table_name } of tablesRes.rows) {
    console.log(`\n============================`);
    console.log(`TABLE: ${table_schema}.${table_name}`);
    console.log(`============================`);

    // ---- Columns ----
    const cols = await client.query(
      `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2
      ORDER BY ordinal_position;
    `,
      [table_schema, table_name]
    );

    console.log("\nColumns:");
    for (const c of cols.rows) {
      const type =
        c.data_type +
        (c.character_maximum_length
          ? `(${c.character_maximum_length})`
          : "");

      console.log(
        `  - ${c.column_name}: ${type} ${
          c.is_nullable === "YES" ? "NULL" : "NOT NULL"
        }${c.column_default ? ` DEFAULT ${c.column_default}` : ""}`
      );
    }

    // ---- Constraints ----
    const constraints = await client.query(
      `
      SELECT
        tc.constraint_type,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name   AS foreign_table_name,
        ccu.column_name  AS foreign_column_name
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
      WHERE tc.table_schema=$1 AND tc.table_name=$2
      ORDER BY tc.constraint_type, tc.constraint_name;
    `,
      [table_schema, table_name]
    );

    console.log("\nConstraints:");
    if (constraints.rows.length === 0) {
      console.log("  (none)");
    } else {
      for (const row of constraints.rows) {
        if (row.constraint_type === "FOREIGN KEY") {
          console.log(
            `  - FK ${row.constraint_name}: ${row.column_name} -> ${row.foreign_table_schema}.${row.foreign_table_name}(${row.foreign_column_name})`
          );
        } else {
          console.log(
            `  - ${row.constraint_type} ${row.constraint_name}: ${row.column_name || ""}`
          );
        }
      }
    }

    // ---- Indexes ----
    const indexes = await client.query(
      `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname=$1 AND tablename=$2
      ORDER BY indexname;
    `,
      [table_schema, table_name]
    );

    console.log("\nIndexes:");
    if (indexes.rows.length === 0) {
      console.log("  (none)");
    } else {
      for (const idx of indexes.rows) {
        console.log(`  - ${idx.indexname}: ${idx.indexdef}`);
      }
    }
  }

  await client.end();
  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
