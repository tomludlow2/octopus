# Octopus

Tools to ingest Octopus Energy usage into PostgreSQL, identify EV charging sessions, and price those sessions using interval tariffs.

## Prerequisites
- Node.js + npm
- PostgreSQL
- Octopus account + meter identifiers
- Root config files: `config.json`, `tariff.json`, `db_connect.json`

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

## Current ingestion workflow (v2)
- Main entrypoint used by automation: `npm run fetch:auto` → `lib/fetchLatestAuto.js`.
- `fetchLatestAuto`:
  1. Finds latest common timestamp across `electric_consumption` + `gas_consumption`.
  2. Imports from 24h before that timestamp to now.
  3. Calls `fetchProcessAndInsertOctopusData(...)`.
  4. Sends last-3-days success usage notification.
- `lib/octopusDataProcessor.js` delegates to `lib/octopusImporter.js`.
- `lib/octopusImporter.js`:
  - fetches Octopus usage and tariff rates,
  - applies gas conversion only for gas rows,
  - prices electric with `value_exc_vat`, gas with `value_inc_vat`,
  - upserts into `electric_consumption` + `gas_consumption`,
  - writes activity logs (`./logs/activity-YYYY-MM-DD.log`).

## EV charge workflow
- Ingest Audi/Home Assistant state events into `audi_events` (via websocket listener or historical loaders).
- Identify charging sessions: `lib/audiDataProcessor.js` + `lib/chargeEventInsert.js`.
- Price charging sessions: `lib/priceChargeEvent.js` using interval usage and `energy_baseline.json`.

## Running servers (in active use)
- `server/web_server.js` (port `52529`):
  - `/logs` activity log viewer
  - `/view-electric` and `/view-gas` chart/report pages
  - Session auth enabled; configure users via `server/web_users.json` (or `WEB_AUTH_USERS`)
- `server/webhook_server.js` (port `52530`): webhook payload logger to `server/webhook_calls/`.
- `server/socket_listener.js`: Home Assistant websocket listener for Audi charging state events.

See `SERVER_SETUP.md` for a full endpoint/page reference and auth details.

## NPM scripts
- `npm test` → syntax validation across `lib`, `pg`, `server`, `tests`
- `npm run fetch:auto` → latest overlap auto-import + 3-day notification
- `npm run fetch:backfill` → manual day-by-day historical import iterator
- `npm run charge:identify:auto` → scheduled charge-event identification
- `npm run charge:identify:backfill` → manual historical Audi event processing
- `npm run charge:price:auto` → process all charging events
- `npm run charge:price:next` → process next unpriced charging event
- `npm run db:gaps -- --start <iso> --end <iso> [--source electric|gas|both] [--limit 200]`
- `npm run gaps:import -- --start <iso> --end <iso> [--source electric|gas|both] [--limit 10000] [--max-ranges 200] [--dry-run]`
- `npm run electric:reprice -- --start <iso> --end <iso> [--dry-run]`
- `npm run usage:reprice -- --start <iso> --end <iso> [--source electric|gas|both] [--dry-run]`
- `npm run db:inspect`
- `npm run fetch:monthly:interactive -- --start-month YYYY-MM [--max-months 12]`
- `npm run usage:last-7-days`
- `npm run usage:last-month`
- `npm run interrogate -- --start <iso> --end <iso> [--source electric|gas|both]`
- `npm run test:basic-notification`
- `npm run test:url-notification`
- `npm run test:error_notification`

## Utilities
- Missing intervals detector: `npm run db:gaps ...`
- Missing intervals importer: `npm run gaps:import ...`
- Usage repricing: `npm run usage:reprice ...`
- Interrogation report export: `npm run interrogate ...` writes `reports/interrogation_dd_mm_yy_hh_mm.json`

## Notifications
- `lib/localNotifier.js` sends to `http://localhost:55000/api/notify` by default.
- Usage summaries:
  - weekly: `npm run usage:last-7-days`
  - monthly: `npm run usage:last-month`
  - auto-import success: triggered by `fetch:auto` (last 3 days)

## Repository organization notes
- Legacy v1 ingestion/automation code moved to `legacy/v1/lib/`.
- Manual/diagnostic Postgres scripts moved to `pg/manual/`.

## Notes
- Standing charge handling exists in legacy v1 modules and is not part of the current v2 importer path.
- `DATABASE_SETUP.md` contains table creation/permission guidance.
