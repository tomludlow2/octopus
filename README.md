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
This will override the data, it doesn't currently check for existing data. Probably safest to keep this in for now. 

## Reprice historical usage]
This only becomes useful if there is a retrospective change in the tariff information. For example if the tariff changes and the system fails to recognise this, you would use this go and "re-price" all of the units of energy through that time. 
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
- Importing runs through `lib/octopusImporter.js` and writes only to existing tables:
  - `electric_consumption`
  - `gas_consumption`
  - (existing standing charge handling remains in legacy scripts)
- Import logic:
  - detects missing half-hour intervals in the existing consumption tables,
  - fetches Octopus usage for missing intervals,
  - always refreshes a retrospective backfill window (`OCTOPUS_BACKFILL_DAYS`, default `14`) so late Octopus corrections are actioned by updating existing rows,
  - upserts into existing consumption tables using `ON CONFLICT (start_time)`.
- Activity logs are written to `./logs/activity-YYYY-MM-DD.log` (append-only, one line per operation).
- Use web endpoint `/logs?date=YYYY-MM-DD&lines=500` to inspect activity logs.
- Graph views:
  - `/view-electric?range=day|week|month&date=YYYY-MM-DD`
  - `/view-gas?range=day|week|month&date=YYYY-MM-DD`

### Idempotency verification
Run the same import twice for the same period:
```bash
npm run fetch:auto
npm run fetch:auto
```
Then verify row counts stay stable:
```bash
psql -d octopus_db -c "SELECT COUNT(*) FROM electric_consumption;"
psql -d octopus_db -c "SELECT COUNT(*) FROM gas_consumption;"
```


### Inspect schema/tables/permissions (for adapting to your DB role)
Use:
```bash
npm run db:inspect
```

This prints the current user, search path, schema-level `USAGE/CREATE` privileges, table/column layout, and table privileges for the current user.


## Interactive monthly backfill (manual Y/N confirmation)
Use:
```bash
npm run fetch:monthly:interactive -- --start-month 2024-11 --max-months 12
```

Behavior:
- Starts from `--start-month` when provided, otherwise current month, then walks backwards month-by-month.
- Prompts for each month: import (`Y`), skip (`N`), or quit (`Q`).
- After each import it prints inserted/updated counts for electric and gas.
- Writes a month-by-month JSON report to `./reports/monthly_import_<timestamp>.json`.


## Local notification endpoint module
- Module: `lib/localNotifier.js`
- Default endpoint: `http://localhost:55000/api/notify`
- Payload format:
  - required: `title`, `body`, `sendNow` (defaults to `true`)
  - optional: `html` (preferred for simple styled notifications) OR `url` (for complex interactions)

Live endpoint checks (sends real notifications to configured local endpoint):
```bash
npm run test:basic-notification
npm run test:url-notification
```


## Usage summary notifications
- Weekly summary notification (last 7 days up to most recent imported common fuel date):
```bash
npm run usage:last-7-days
```
This includes:
- total electric/gas kWh and cost,
- day-by-day table of electric/gas kWh,
- comparison to previous 7-day cost window.

- Last calendar month summary notification:
```bash
npm run usage:last-month
```
This includes:
- total electric/gas kWh and cost,
- top 3 gas days and top 3 electric days,
- delta vs previous month (kWh and cost).

## Error notification helper
- Helper: `localErrorNotify(errorType, errorDescription, { logFile?, url? })` in `lib/localNotifier.js`.
- Test trigger:
```bash
npm run test:error_notification
```


## Interrogate DB vs Octopus raw data
Use:
```bash
npm run interrogate -- --start 2024-01-01T00:00:00Z --end 2024-02-01T00:00:00Z --source both
```

This will:
- print human-readable CLI tables for each selected fuel,
- show tariff/product periods detected for that range,
- compare DB interval rows vs Octopus API interval rows,
- highlight mismatches (missing in DB/API or value mismatches),
- export full raw/intermediate data to `reports/interrogation_dd_mm_yy_hh_mm.json`.
