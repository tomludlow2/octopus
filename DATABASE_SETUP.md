# PostgreSQL Database Setup for Octopus Energy Data

This guide will walk you through setting up a PostgreSQL database with the necessary tables for storing gas and electric consumption data, standing charges, and electric car charging events.

## 1. Create PostgreSQL User and Database

1. **Login to PostgreSQL**:

`sudo -u postgres psql`


2. **Create a new user (`octopus_user`)**:
`CREATE USER octopus_user WITH PASSWORD 'your_secure_password';`


3. **Create a new database (`octopus_db`)**:
`CREATE DATABASE octopus_db;`


4. **Grant privileges for the user to the new database**:
`GRANT ALL PRIVILEGES ON DATABASE octopus_db TO octopus_user;`


5. **Switch to the new database**:
`\c octopus_db`


6. Create a `db_connect.json` file in the top directory with:
```json
{
	"user": "octopus_user",
    "host": "localhost",
    "database": "octopus_db",
    "password": "your_secure_password",
    "port": 5432,
}
```

## 2. Create Tables

### 2.1 Gas Consumption Table
Create a table to store 30-minute intervals of gas consumption data.

### 2.2 Electric Consumption Table
Create a table to store 30-minute intervals of electric consumption data.

### 2.3 Standing Charges Table
Create a table to store standing charges (likely updated once or twice per year).

### 2.4 Charging Events Table
Create a table to store electric vehicle charging events.

```sql
CREATE TABLE gas_consumption (
 id SERIAL PRIMARY KEY,
 consumption_kwh NUMERIC(10, 3) NOT NULL,
 price_pence NUMERIC(10, 2) NOT NULL,
 start_time TIMESTAMPTZ NOT NULL,
 end_time TIMESTAMPTZ NOT NULL,
 UNIQUE (start_time)
);

CREATE TABLE electric_consumption (
    id SERIAL PRIMARY KEY,
    consumption_kwh NUMERIC(10, 3) NOT NULL,
    price_pence NUMERIC(10, 2) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    UNIQUE (start_time)
);

CREATE TABLE standing_charges (
    id SERIAL PRIMARY KEY,
    energy_type VARCHAR(10),
    price_pence NUMERIC(10, 2) NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    UNIQUE (energy_type, valid_from)
);

CREATE TABLE charging_events (
    id SERIAL PRIMARY KEY,
    energy_used_kwh NUMERIC(10, 3) NOT NULL,
    estimated_cost NUMERIC(10, 2) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    settled BOOLEAN DEFAULT FALSE,
    UNIQUE (start_time)
);
```

## 3. Grant Permissions for User

```sql
GRANT CONNECT ON DATABASE octopus_db TO octopus_user;
GRANT ALL PRIVILEGES ON TABLE gas_consumption TO octopus_user;
GRANT ALL PRIVILEGES ON TABLE electric_consumption TO octopus_user;
GRANT ALL PRIVILEGES ON TABLE standing_charges TO octopus_user;
GRANT ALL PRIVILEGES ON TABLE charging_events TO octopus_user;
GRANT USAGE, SELECT ON SEQUENCE charging_events_id_seq TO octopus_user;
GRANT USAGE, SELECT ON SEQUENCE electric_consumption_id_seq TO octopus_user;
GRANT USAGE, SELECT ON SEQUENCE gas_consumption_id_seq TO octopus_user;
GRANT USAGE, SELECT ON SEQUENCE standing_charges_id_seq TO octopus_user;
```

## 4. Verify
List the tables to ensure they exist:
`\dt`

Ensure the octopus_user has the necessary privileges on the tables
`\dp`

## 5. Backup
`pg_dump -U octopus_user -F c octopus_db -f octopus_db_backup.dump`

Restore:
`pg_restore -U octopus_user -d octopus_db octopus_db_backup.dump`
