# Octopus

Tools to pull Octopus Energy API data, identify EV charge events, and store priced results in PostgreSQL.

## Prerequisites
- Node.js + npm.
- Octopus Energy account details.
- `config.json`, `tariff.json`, and `db_connect.json` in the repository root.

## Configuration

### `config.json`
```json
{
  "account_num": "your_account_number",
  "api_key": "your_api_key",
  "e_mpan": "electricity_mpan",
  "e_sn": "electricity_serial_number",
  "g_mprn": "gas_mprn",
  "g_sn": "gas_serial_number",
  "direct_debit": true
}
```

### `tariff.json`
```json
{
  "electric_product_code": "PRODUCT_CODE",
  "gas_product_code": "PRODUCT_CODE",
  "electricity_tariff_code": "TARIFF_CODE",
  "gas_tariff_code": "TARIFF_CODE",
  "gas_conversion": 11.22063333
}
```

### `db_connect.json`
```json
{
  "user": "octopus_user",
  "host": "localhost",
  "database": "octopus_db",
  "password": "your_secure_password",
  "port": 5432
}
```

## Workflow overview

### 1) Fetch + process Octopus usage
- Core function: `lib/octopusDataProcessor.js` → `fetchProcessAndInsertOctopusData(startDate, endDate, results)`.
- Collects usage/rates/standing charge data with `getOctopusData`.
- Unit rates are resolved from account agreement history (`/accounts/{account}/`) so historical intervals use the tariff active at that time.
- Processes usage pricing with `processPrices`.
- Inserts into:
  - `gas_consumption`,
  - `electric_consumption`,
  - `standing_charges`.

### 2) Identify charging events
- `lib/audiDataProcessor.js` and `lib/chargeEventInsert.js` process Audi/Home Assistant state events and insert into `charging_events`.

### 3) Price charging events
- `lib/priceChargeEvent.js` reads interval usage, subtracts baseline values from `energy_baseline.json`, and updates charging event cost/energy totals.

### 4) Automation wrappers
- `lib/AUTO_CALL_OCTOPUS.js` fetches Octopus data for the scheduled window.
- `lib/AUTO_CHARGE_EVENT.js` identifies charge events.
- `lib/autoPriceChargeEvents.js` prices charge events.

## Is `invokeDataProcessor.js` part of normal automation?
No. It is a manual backfill helper, not a scheduler entrypoint. It is useful when you need to ingest historical ranges day-by-day. Normal scheduled runs use `AUTO_CALL_OCTOPUS.js` and the other `AUTO_*` wrappers.

## NPM scripts
- `npm test` → syntax validation across `lib`, `pg`, `server`, `tests`.
- `npm run fetch:auto` → run scheduled-style Octopus fetch wrapper.
- `npm run fetch:backfill` → run manual daily backfill iterator.
- `npm run charge:identify:auto` → run automated charge event identifier.
- `npm run charge:identify:backfill` → run manual Audi event processing.
- `npm run charge:price:auto` → process all charge events.
- `npm run charge:price:next` → process next unpriced charge event.
- `npm run db:gaps -- --start <iso> --end <iso> [--source electric|gas|both] [--limit 200]`.
- `npm run gaps:import -- --start <iso> --end <iso> [--source electric|gas|both] [--limit 10000] [--max-ranges 200] [--dry-run]`.
- `npm run electric:reprice -- --start <iso> --end <iso> [--dry-run]`.
- `npm run usage:reprice -- --start <iso> --end <iso> [--source electric|gas|both] [--dry-run]`.

## Finding missing periods in DB records
Use:
```bash
npm run db:gaps -- --start 2024-12-01T00:00:00Z --end 2024-12-05T00:00:00Z --source both --limit 200
```

This checks expected 30-minute intervals and reports missing ranges for `electric_consumption`, `gas_consumption`, or both.



## Import missing intervals
Use:
```bash
npm run gaps:import -- --start 2024-12-01T00:00:00Z --end 2024-12-05T00:00:00Z --source both --max-ranges 50 --dry-run
```

This reads missing ranges from the DB gap check and re-runs the Octopus fetch/process/insert pipeline for each range. Remove `--dry-run` to write data.

## Reprice historical usage
Use:
```bash
npm run usage:reprice -- --start 2024-12-01T00:00:00Z --end 2024-12-08T00:00:00Z --source both --dry-run
```

This recalculates `electric_consumption` and/or `gas_consumption` rows by matching each interval timestamp to the tariff agreement active at that time, then pulling the corresponding Octopus unit rates for that tariff period. Remove `--dry-run` to persist updates.

If you only need electric repricing, keep using:
```bash
npm run electric:reprice -- --start 2024-12-01T00:00:00Z --end 2024-12-08T00:00:00Z --dry-run
```

## Notes
- Octopus billing calculations can differ slightly from API output due to rounding and VAT handling.
- `DATABASE_SETUP.md` contains table creation and permission steps.


## How it works (Postgres as source of truth)
- Importing now runs through `lib/octopusImporter.js`, which:
  - checks missing half-hour intervals in `electric_consumption` and `gas_consumption`,
  - fetches Octopus consumption only for missing ranges,
  - fetches rate intervals for the requested period plus a retrospective backfill window (`OCTOPUS_BACKFILL_DAYS`, default `14`) to catch late Octopus corrections,
  - upserts interval rates into `octopus_rate_intervals` and consumption into fuel usage tables.
- Retrospective rate changes are detected by comparing stored vs fetched interval values/source hashes and written to `octopus_rate_change_audit`.
- If the DB user cannot create schema objects (e.g. no `CREATE` on `public`), importer automatically falls back to the legacy ingestion path so existing installs keep working while you arrange migration privileges.
- Activity logs are written to `./logs/activity-YYYY-MM-DD.log` (append-only, one line per operation).
- Use web endpoint `/logs?date=YYYY-MM-DD&lines=500` to inspect activity logs.
- New graph views:
  - `/view-electric?range=day|week|month&date=YYYY-MM-DD`
  - `/view-gas?range=day|week|month&date=YYYY-MM-DD`

### Idempotency verification
Run the same import twice for the same period:
```bash
npm run fetch:auto
npm run fetch:auto
```
Then verify row counts don't balloon and rate changes are audited only when values differ:
```bash
psql -d octopus_db -c "SELECT COUNT(*) FROM electric_consumption;"
psql -d octopus_db -c "SELECT COUNT(*) FROM gas_consumption;"
psql -d octopus_db -c "SELECT COUNT(*) FROM octopus_rate_change_audit;"
```
