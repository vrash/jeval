#!/usr/bin/env bash
# Run both example splits and score each against its labels file.
#
#   bash benchmark.sh               # fixture mode (simulated, offline)
#   bash benchmark.sh --mode live   # real Jev; needs TYPESAFE_API_KEY and sends the cases to TypeSafe
#
# Tune thresholds only on the tuning split; report numbers only from the holdout split.
set -euo pipefail
CLI="$(cd "$(dirname "$0")/.." && pwd)/packages/cli/dist/cli.js"
cd "$(dirname "$0")"

MODE="fixture"
case "${1:-}" in
  --mode) MODE="${2:?usage: benchmark.sh [--mode fixture|live]}"; shift 2 ;;
  --mode=*) MODE="${1#--mode=}"; shift ;;
  "") ;;
  *) echo "usage: bash benchmark.sh [--mode fixture|live]" >&2; exit 3 ;;
esac
case "$MODE" in
  fixture|live) ;;
  *) echo "mode must be 'fixture' or 'live' (got '$MODE')" >&2; exit 3 ;;
esac

# Use the workspace-linked CLI when present (after `pnpm install`), otherwise go through pnpm.
if [ -x node_modules/.bin/jeval ]; then
  JEVAL="node_modules/.bin/jeval"
else
  JEVAL="pnpm exec jeval"
fi

if [ "$MODE" = "fixture" ]; then
  echo "== SIMULATED benchmark (fixture provider). Numbers reflect hand-authored fixtures, not Jev. =="
else
  echo "== LIVE benchmark: sending the example cases to TypeSafe's Jev =="
fi

mkdir -p runs

echo
echo "## tuning split"
$JEVAL run --mode "$MODE" --config jeval.config.json --out runs/tuning.json --html
echo
$JEVAL benchmark runs/tuning.json --labels data/labels.tuning.jsonl --out runs/benchmark.tuning.json

echo
echo "## holdout split"
$JEVAL run --mode "$MODE" --config jeval.holdout.config.json --out runs/holdout.json --html
echo
$JEVAL benchmark runs/holdout.json --labels data/labels.holdout.jsonl --out runs/benchmark.holdout.json
