#!/usr/bin/env bash
# Verifies that the published artefacts work outside the workspace:
# packs @jeval/core, @jeval/provider-jev and @jeval/cli, installs the tarballs into a fresh
# project with npm, runs the CLI binary and imports the SDK from both ESM and CJS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "packing workspace packages into $TMP"
pnpm -r --filter './packages/*' build >/dev/null
for pkg in core provider-jev cli; do
  (cd "$ROOT/packages/$pkg" && pnpm pack --pack-destination "$TMP" >/dev/null)
done
ls -1 "$TMP"/*.tgz

echo "installing tarballs into a fresh npm project"
mkdir -p "$TMP/consumer" && cd "$TMP/consumer"
npm init -y >/dev/null
# core first so the provider/cli tarballs resolve their workspace dependency to the packed version
npm install --no-audit --no-fund --silent "$TMP"/jeval-core-*.tgz
npm install --no-audit --no-fund --silent "$TMP"/jeval-provider-jev-*.tgz "$TMP"/jeval-cli-*.tgz

echo "checking package exports (ESM + CJS)"
cat > esm-check.mjs <<'JS'
import { evaluateCase, FixtureProvider, builtinRubric, EXIT } from "@jeval/core";
import { JevProvider, JEV_INTEGRATION } from "@jeval/provider-jev";
const r = await evaluateCase(
  { id: "x", input: "hi", output: "Booked!", policy: "p", toolEvents: [{ id: "t", name: "book_appointment", status: "failure" }] },
  [builtinRubric("booking-claim")],
  { provider: new FixtureProvider({ fixtures: { model: "m", cases: { x: { "booking-claim.claim": { probabilities: { claims_completed: 0.9, does_not_claim: 0.05, unclear: 0.05 } } } } } }) },
);
if (r.checks[0].status !== "fail") throw new Error("unexpected status " + r.checks[0].status);
if (typeof JevProvider !== "function" || JEV_INTEGRATION.sdkPackage !== "@typesafe-ai/sdk") throw new Error("provider export broken");
console.log("esm ok", r.checks[0].status, "exit codes", EXIT);
JS
node esm-check.mjs
cat > cjs-check.cjs <<'JS'
const { evaluateGates, EXIT } = require("@jeval/core");
const { JevProvider } = require("@jeval/provider-jev");
if (typeof evaluateGates !== "function" || typeof JevProvider !== "function" || EXIT.usage !== 3) throw new Error("cjs exports broken");
console.log("cjs ok");
JS
node cjs-check.cjs

echo "running the installed CLI binary"
npx --no-install jeval --version
npx --no-install jeval init evals >/dev/null
cd evals
set +e
npx --no-install jeval run --mode fixture --html --quiet --ci
code=$?
set -e
# the starter dataset contains a deliberate failure, so the strict gate must exit 1
if [ "$code" != "1" ]; then echo "expected exit 1 from strict CI on starter data, got $code"; exit 1; fi
npx --no-install jeval report runs/*.json >/dev/null
npx --no-install jeval labels dataset.jsonl -o labels.jsonl >/dev/null
npx --no-install jeval benchmark runs/*.json --labels labels.jsonl | head -3
set +e
npx --no-install jeval run --mode live --quiet >/dev/null 2>&1
code=$?
set -e
if [ "$code" != "3" ]; then echo "expected exit 3 for live mode without a key, got $code"; exit 1; fi
echo "packed packages verified"
