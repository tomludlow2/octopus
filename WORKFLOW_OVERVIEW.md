# Octopus Workflow Overview

## Purpose
This project ingests Octopus API data, stores interval data in PostgreSQL, identifies EV charging events from Audi/Home Assistant records, and prices those events using interval tariffs and a baseline household profile.

## End-to-end workflow

### 1) Configure credentials and tariff metadata
1. Add `config.json` (account/API + meter IDs).
2. Add `tariff.json` (product codes, tariff codes, gas conversion factor).
3. Add `db_connect.json` (PostgreSQL credentials).

### 2) Fetch and insert Octopus data
- Primary pipeline: `fetchProcessAndInsertOctopusData(startDate, endDate, results)` in `lib/octopusDataProcessor.js`.
- Processing stages:
  1. Download usage/rates/standing charges with `getOctopusData`.
  2. Calculate interval prices with `processPrices`.
  3. Insert or upsert rows into:
     - `gas_consumption`,
     - `electric_consumption`,
     - `standing_charges`.

### 3) Identify charge events
- Source data is loaded into `audi_events` through:
  - `server/socket_listener.js` (live), or
  - `server/test_populate_old_audi_data.js` (historical).
- `lib/audiDataProcessor.js` derives charging sessions and writes to `charging_events` through `lib/chargeEventInsert.js`.

### 4) Price charge events
- `lib/priceChargeEvent.js` maps charge windows to 30-minute intervals.
- It subtracts baseline household usage (`energy_baseline.json`) and updates `charging_events` with `energy_used` and `estimated_cost` where validation criteria pass.

### 5) Automation entrypoints
- `lib/AUTO_CALL_OCTOPUS.js`: scheduled Octopus fetch.
- `lib/AUTO_CHARGE_EVENT.js`: scheduled charge-event identification.
- `lib/autoPriceChargeEvents.js`: scheduled event pricing.

### 6) Manual backfill entrypoints
- `lib/invokeDataProcessor.js`: day-by-day historical Octopus ingestion.
- `lib/invokeAudiProcessor.js`: historical charge-event identification.
- `lib/invokePriceChargeEvent.js`: process next unpriced event.

## Is `invokeDataProcessor.js` used in the main workflow?
Not for normal automation. It is a manual historical backfill tool. The main automated workflow uses `AUTO_CALL_OCTOPUS.js` and related `AUTO_*` scripts.

## Data quality utility: identify missing intervals
- New utility: `pg/view_missing_intervals.js`.
- It compares expected 30-minute timestamps against `electric_consumption` and/or `gas_consumption` and reports contiguous missing ranges.
- Example:
```bash
node pg/view_missing_intervals.js --start 2024-12-01T00:00:00Z --end 2024-12-03T00:00:00Z --source both --limit 200
```
