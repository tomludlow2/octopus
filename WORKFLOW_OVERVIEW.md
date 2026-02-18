# Octopus Workflow Overview

## Purpose
This project ingests Octopus interval usage into PostgreSQL, identifies EV charging sessions from Audi/Home Assistant events, and estimates charging costs.

## 1) Configuration
Create in repo root:
- `config.json` (Octopus account/API + meter IDs + direct debit flag)
- `tariff.json` (tariff/product metadata + gas conversion factor)
- `db_connect.json` (PostgreSQL connection)

## 2) Current import workflow (v2)
### Scheduled/latest run
- `npm run fetch:auto` → `lib/fetchLatestAuto.js`
- Behavior:
  - find latest common interval timestamp between gas + electric tables,
  - import from 24h before that timestamp to now,
  - send last-3-days usage/cost notification.

### Import engine
- `lib/octopusDataProcessor.js` calls `importOctopusData(...)` in `lib/octopusImporter.js`.
- `lib/octopusImporter.js`:
  - fetches interval usage for gas/electric,
  - resolves account-aware tariff periods and rates,
  - converts gas units to kWh via `tariff.gas_conversion` (gas only),
  - prices electric via `value_exc_vat`, gas via `value_inc_vat`,
  - upserts `electric_consumption` and `gas_consumption`,
  - logs activity to `logs/activity-YYYY-MM-DD.log`.

### Manual import/backfill tools
- `npm run fetch:backfill`
- `npm run gaps:import -- --start ... --end ...`
- `npm run fetch:monthly:interactive -- --start-month YYYY-MM`

## 3) EV charging workflow
- Event capture:
  - `server/socket_listener.js` (live Home Assistant websocket)
  - `server/webhook_server.js` (webhook logger utility)
  - `server/test_populate_old_audi_data.js` (historical population helper)
- Charge event identification:
  - `npm run charge:identify:auto`
  - `npm run charge:identify:backfill`
- Charge event pricing:
  - `npm run charge:price:auto`
  - `npm run charge:price:next`

## 4) Web UI / operations endpoints
- `server/web_server.js`:
  - `/logs`
  - `/view-electric`
  - `/view-gas`

## 5) Data quality / repricing / diagnostics
- `npm run db:gaps -- --start ... --end ... [--source ...]`
- `npm run usage:reprice -- --start ... --end ... [--source ...] [--dry-run]`
- `npm run electric:reprice -- --start ... --end ... [--dry-run]`
- `npm run interrogate -- --start ... --end ... [--source ...]`
- `npm run db:inspect`

## 6) Notifications
- Local notifier helper: `lib/localNotifier.js`
- Usage summaries:
  - `npm run usage:last-7-days`
  - `npm run usage:last-month`
- Auto-import success notification (last 3 days) is emitted by `fetch:auto`.

## 7) Test / validation entrypoints
- `npm test` (syntax check suite)
- `npm run test:basic-notification`
- `npm run test:url-notification`
- `npm run test:error_notification`

## 8) Repository layout updates
- Legacy v1 ingestion/automation code: `legacy/v1/lib/`
- Manual/diagnostic DB scripts: `pg/manual/`
