#!/usr/bin/env bash
# Rebuilds the public benchmark datasets from upstream and runs them live against Jev.
# Needs examples/.env (TYPESAFE_API_KEY plus, for Vercel AI Gateway, TYPESAFE_BASE_URL and TYPESAFE_DEFAULT_MODEL).
# Total cost at the documented rate is about $0.06; every run is guarded by --max-usd.
set -euo pipefail
cd "$(dirname "$0")"
CLI="$(cd ../.. && pwd)/packages/cli/dist/cli.js"
[ -f "$CLI" ] || { echo "build the packages first: pnpm build (from the repo root)"; exit 1; }
[ -f .env ] || cp ../.env .env 2>/dev/null || { echo "missing .env with TYPESAFE_API_KEY"; exit 1; }

mkdir -p raw
[ -d raw/ragtruth ] || git clone -q --depth 1 https://github.com/ParticleMedia/RAGTruth.git raw/ragtruth
[ -d raw/halueval ] || git clone -q --depth 1 https://github.com/RUCAIBox/HaluEval.git raw/halueval
[ -d raw/taubench ] || git clone -q --depth 1 https://github.com/sierra-research/tau-bench.git raw/taubench
node build.mjs
node "$CLI" capture data/taubench.chat.jsonl -o data/taubench.jsonl --format chat --metadata-fields domain,reward --id-prefix taubench --append >/dev/null

run() { # name
  node "$CLI" run --mode live --config "jeval.$1.json" -o "runs/$1.json" --max-usd 0.10 --quiet --html
}
bench() { node "$CLI" benchmark "runs/$1.json" --labels "data/$1.labels.jsonl" -o "results/$1.benchmark.json"; }

mkdir -p results
# 1. tuning split first; adjust thresholds in jeval.ragtruth.holdout.json only from this
run ragtruth.tuning && bench ragtruth.tuning
# 2. held-out sets, once
run ragtruth.holdout && bench ragtruth.holdout
run halueval.holdout && bench halueval.holdout
# 3. agent trajectories (no per-check labels; report the status mix)
run taubench
echo "done: see results/*.benchmark.json and runs/*.html"
