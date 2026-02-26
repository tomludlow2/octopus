#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

START_DAYS_AGO="${REPRICE_START_DAYS_AGO:-45}"
END_DAYS_AGO="${REPRICE_END_DAYS_AGO:-0}"
SOURCE="${REPRICE_SOURCE:-both}"
DRY_RUN="${REPRICE_DRY_RUN:-false}"

START_ISO="$(date -u -d "${START_DAYS_AGO} days ago" +%Y-%m-%dT00:00:00Z)"
END_ISO="$(date -u -d "${END_DAYS_AGO} days ago" +%Y-%m-%dT00:00:00Z)"

ARGS=(--start "$START_ISO" --end "$END_ISO" --source "$SOURCE")
if [[ "$DRY_RUN" == "true" ]]; then
  ARGS+=(--dry-run)
fi

echo "[run-reprice-window] Running usage repricing from $START_ISO to $END_ISO source=$SOURCE dry_run=$DRY_RUN"
exec npm run usage:reprice -- "${ARGS[@]}"
