#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

MODE="${AUDIT_MODE:-regular}"
FUEL="${AUDIT_FUEL:-both}"
SEED="${AUDIT_SEED:-42}"
NOTIFY_UNCERTAIN="${AUDIT_NOTIFY_UNCERTAIN:-false}"

ARGS=(--mode="$MODE" --fuel="$FUEL" --seed="$SEED")
if [[ "$NOTIFY_UNCERTAIN" == "true" ]]; then
  ARGS+=(--notify-uncertain)
fi

echo "[run-audit-window] Running audit mode=$MODE fuel=$FUEL seed=$SEED notify_uncertain=$NOTIFY_UNCERTAIN"
exec npm run audit:octopus -- "${ARGS[@]}"
