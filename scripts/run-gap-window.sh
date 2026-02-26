#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

START_DAYS_AGO="${GAP_START_DAYS_AGO:-14}"
END_DAYS_AGO="${GAP_END_DAYS_AGO:-0}"
SOURCE="${GAP_SOURCE:-both}"
LIMIT="${GAP_LIMIT:-10000}"
MAX_RANGES="${GAP_MAX_RANGES:-200}"
DRY_RUN="${GAP_DRY_RUN:-false}"

START_ISO="$(date -u -d "${START_DAYS_AGO} days ago" +%Y-%m-%dT00:00:00Z)"
END_ISO="$(date -u -d "${END_DAYS_AGO} days ago" +%Y-%m-%dT00:00:00Z)"

VIEW_ARGS=(--start "$START_ISO" --end "$END_ISO" --source "$SOURCE" --limit "$LIMIT")
IMPORT_ARGS=(--start "$START_ISO" --end "$END_ISO" --source "$SOURCE" --limit "$LIMIT" --max-ranges "$MAX_RANGES")

if [[ "$DRY_RUN" == "true" ]]; then
  IMPORT_ARGS+=(--dry-run)
fi

echo "[run-gap-window] Viewing gaps from $START_ISO to $END_ISO source=$SOURCE limit=$LIMIT"
npm run db:gaps -- "${VIEW_ARGS[@]}"

echo "[run-gap-window] Importing gaps from $START_ISO to $END_ISO source=$SOURCE limit=$LIMIT max_ranges=$MAX_RANGES dry_run=$DRY_RUN"
exec npm run gaps:import -- "${IMPORT_ARGS[@]}"
