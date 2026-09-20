# jeval

**Know when your AI gets it wrong.** Open-source evaluations for AI outputs and agents. Define your checks, run them with [TypeSafe's Jev](https://docs.typesafe.ai), and inspect failures and uncertain results.

jeval is an independent project that uses TypeSafe's Jev as its first judge provider. It is not affiliated with TypeSafe. Package names (`@jeval/*`) and the domain are provisional; nothing has been published to npm yet (the unscoped name `jeval` on npm belongs to an unrelated project).

- **jeval open source** (this repository): TypeScript SDK, CLI, rubrics, local HTML reports, examples. No account; bring your own TypeSafe API key. MIT.
- **jeval Cloud** (planned): managed runs, saved history, shared dashboards, alerts and team workflows. Waitlist only; nothing is built yet.

## What it does

- A **case** is one thing to evaluate: user input, assistant output, optional conversation, supplied reference material, the policy the assistant had to follow, and recorded tool events. Expected labels and metadata ride along for the harness and are never sent to the judge.
- A **rubric** is one narrow check with a stable id and version. Five kinds ship: policy compliance, claim support against references, tool-backed action claims, required escalation handling, and custom natural-language criteria. Exact conditions (tool status, output fields) are checked in code and composed with one Jev multiple-choice question per semantic part.
- Every check for a case goes in **one Jev request**. Probabilities become `pass`, `fail` or `review` through thresholds you control (`pass + fail > 1` is enforced so both can never fire). Missing evidence is `review`, inapplicable checks are `skipped` with a reason, and provider failures are `error`, never a decision.
- Long conversations are digested to fit the judge's input limit (head and tail turns kept, one visible marker, omissions recorded as evidence).
- Results keep the full probabilities, the provider's confidence statistic (distribution shape, not accuracy), rubric version, model id, timestamps, request-level usage, latency and an explicitly labelled cost estimate when a rate is configured.

Site: https://getjeval.com (https://jeval.vercel.app serves the same deployment). Source publication is on the launch checklist in `docs/release.md`.

## Quickstart (from a clone)

Requires Node ≥ 20.9 (22 recommended, see `.nvmrc`) and pnpm 10.

```bash
git clone <repository-url> jeval && cd jeval
pnpm install
pnpm build                       # @jeval/core, @jeval/provider-jev, @jeval/cli
pnpm --filter jeval-examples cli # simulated run on examples/data, writes examples/runs/*.html
pnpm --filter jeval-examples sdk # runs examples/sdk-example.ts
```

Real judgments need a TypeSafe key:

```bash
cp examples/.env.example examples/.env   # add TYPESAFE_API_KEY
cd examples && pnpm exec jeval run --mode live --html --ci
```

Live mode sends each case's input, output, conversation, policy, references and tool events to TypeSafe. Nothing else leaves your machine, and there is no telemetry.

No TypeSafe account? Vercel AI Gateway proxies the same API (billed by Vercel, card on file required): set `TYPESAFE_BASE_URL=https://ai-gateway.vercel.sh/typesafe`, `TYPESAFE_DEFAULT_MODEL=typesafe-ai/jev` and use an AI Gateway API key (or `VERCEL_OIDC_TOKEN`) as `TYPESAFE_API_KEY`.

## The SDK in one example

```ts
import { evaluateCase, FixtureProvider, builtinRubric } from "@jeval/core";
import { JevProvider } from "@jeval/provider-jev";

// Real judgments need TYPESAFE_API_KEY and send the case to TypeSafe.
// Without a key this example uses the simulated fixture provider.
const provider = process.env.TYPESAFE_API_KEY
  ? new JevProvider({ model: process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest" })
  : new FixtureProvider();

const result = await evaluateCase(
  {
    id: "booking-42",
    input: "Book me a cleaning for Tuesday at 10am.",
    output: "Done! Your cleaning is booked for Tuesday at 10:00.",
    policy: "Only confirm a booking after the book_appointment tool succeeds.",
    toolEvents: [{ id: "t1", name: "book_appointment", status: "failure", error: "slot unavailable" }],
  },
  [builtinRubric("booking-claim"), builtinRubric("policy-compliance")],
  { provider },
);

for (const check of result.checks) {
  console.log(check.rubricId, check.status, "—", check.reason);
}
console.log(result.request?.simulated ? "simulated run" : `model ${result.request?.model}`, result.request?.usage);
```

`evaluateDataset(cases, rubrics, { provider, concurrency, timeoutMs, maxAttempts, signal })` does the same for a JSONL dataset with bounded concurrency, retries for transient errors, cancellation and per-case error isolation, and returns a `RunReport`.

## CLI

```bash
jeval init [dir]                                  # starter config, rubrics, dataset, fixtures (never overwrites)
jeval capture traces.jsonl -o dataset.jsonl       # import OpenAI chat / OTel GenAI / Langfuse / LangWatch / generic exports
jeval estimate                                    # requests, input tokens and cost before sending anything
jeval run --mode fixture|live [--ci] [--html]     # evaluate a dataset → runs/run-<ts>-<mode>.json
jeval run --mode live --limit 5 --show            # sample: judge five cases, print the judged state beside each verdict
jeval run --mode live --max-usd 0.50              # refuse to start above a cost budget
jeval review runs/<run>.json --labels human.jsonl # walk uncertain results, record human labels
jeval report runs/<run>.json                      # self-contained, script-free HTML
jeval compare runs/<a>.json runs/<b>.json         # new/resolved failures; flags incompatible runs
jeval benchmark runs/<run>.json --labels labels.jsonl
jeval labels dataset.jsonl -o labels.jsonl        # extract embedded provisional labels
```

Exit codes with `--ci`: `0` gates met · `1` quality gate failed · `2` run incomplete (errors, review, empty dataset, skipped required rubric, simulated run) · `3` usage or configuration error. The default policy is strict; loosen it in `jeval.config.json` under `ci` deliberately. See `docs/` and the website docs for details.

## Repository layout

```
packages/core          schemas, rubrics, decisions, dataset runs, reports, compare, benchmark, provider interface, fixture provider
packages/provider-jev  TypeSafe Jev adapter on @typesafe-ai/sdk 0.6.0 (verified 2026-09-19)
packages/cli           jeval executable
apps/web               Next.js 16 site: docs, interactive demo, jeval Cloud waitlist endpoint
examples               synthetic tuning/holdout datasets, labels, fixtures, SDK example, benchmark script
supabase/migrations    waitlist table, shared rate limiter and demo budget, with RLS
docs                   architecture, rubric guide, limitations, release, deployment, waitlist data handling
scripts                verify-packed.sh (install from tarballs), waitlist-admin.mjs (operator export/delete)
```

## Development

```bash
pnpm check           # lint + typecheck + build + unit tests for all packages
pnpm test:web        # waitlist handler tests and the PGlite migration/RLS test (offline)
pnpm test:e2e        # Playwright: desktop + mobile journeys (builds apps/web first: pnpm build:web)
pnpm verify:packed   # pack the packages, install them into a fresh npm project, run the CLI
pnpm test:live       # opt-in: one real Jev request; needs JEVAL_LIVE=1 and TYPESAFE_API_KEY
```

Normal CI is offline and deterministic. Mocked tests establish the framework's behaviour; they say nothing about Jev's judging quality on real data. Use `jeval benchmark` on your own labelled held-out split for that.

## Recorded live run

Both example datasets were judged live by Jev on 2026-09-19 (via Vercel AI Gateway). Held-out split, 10 synthetic cases: failure-detection precision and recall 100% on 25 binary labels (TP 12, FP 0, FN 0, TN 13), 92% agreement on 25 undecidable labels, 16,919 input tokens for ~$0.0007, latency p50 344 ms. Caveats and the per-case disagreements are in `examples/benchmark.live.md`; the labels are synthetic and the sets are small, so treat this as a working end-to-end demonstration, not a claim about your data.

## Documentation

- `docs/architecture.md`: packages, data flow, what is sent to the judge.
- `docs/rubrics.md`: writing and tuning rubrics.
- `docs/limitations.md`: prompt injection, literal judging, synthetic labels, what is unverified.
- `docs/deployment.md`: hosting the site on Vercel with Supabase; required environment variables.
- `docs/waitlist.md`: exactly what the waitlist stores and how to export or delete entries.
- `docs/release.md`: release and publication checklist.
- `examples/README.md`: datasets, labels, provenance, benchmark workflow.

## License

MIT. See `LICENSE`.
