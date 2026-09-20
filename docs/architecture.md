# Architecture

jeval is a pnpm workspace of three publishable packages, one website and an examples project.

```
packages/core ──────────┐
                        ├── packages/cli (jeval executable)
packages/provider-jev ──┘        ▲
        ▲                        │
        └── apps/web (docs, demo, waitlist) ──── supabase/ (migrations)
examples/ (datasets, labels, fixtures, sdk example)
```

## packages/core

Runtime-agnostic (no Node-only imports; it runs in the browser for the demo). Depends only on `zod`.

- `schemas.ts`: `EvalCase`, `Message`, `ToolEvent`, `ContextItem`, `Rubric`, `Thresholds`, `ExpectedLabel`, `LabelRecord`. Runtime validation everywhere data enters.
- `state.ts`: `buildJudgeState(case)` produces the JSON the judge sees under fixed field names (`user_input`, `assistant_response`, `conversation`, `policy`, `reference_material`, `tool_events`). `metadata` and `expected` are never included. Returns the evidence ids that were included so every check can report them.
- `rubrics.ts`: `planCheck(rubric, case, evidence, thresholds)` resolves applicability and deterministic preconditions first, then returns the choice questions to batch and a `decide(answers)` closure that composes code rules with the judge's probabilities.
- `decision.ts`: `decideThreeWay` (fail if p(unacceptable) ≥ fail; pass if p(acceptable) ≥ pass; otherwise review) and `decideOption`. Thresholds must satisfy `pass + fail > 1`.
- `evaluate.ts`: `evaluateCase` (one provider request per case, retries via `retry.ts`, response validation via `provider.ts`) and `evaluateDataset` (bounded concurrency pool, cancellation, per-case error isolation, `RunReport` assembly, dataset and rubric fingerprints, cost estimate).
- `summary.ts`, `gates.ts`, `compare.ts`, `benchmark.ts`, `html.ts`: reporting, CI policy and exit codes, run alignment, judge scoring, script-free escaped HTML.
- `fixture.ts`: deterministic simulated provider; every response carries `simulated: true` and zero latency.
- `provider.ts`: the `JudgeProvider` interface, `ProviderError` with transient classification, and `validateJudgeResponse`.

## packages/provider-jev

`JevProvider` wraps `TypeSafeClient.systemOne` from `@typesafe-ai/sdk` 0.6.0. Each `ChoiceQuestionSpec` becomes `choice(instructions, options)`. The SDK's own retries are disabled so core's retry accounting is exact; `RateLimitError.retryAfterMs` is surfaced. The request id from `x-typesafe-request-id`, the versioned `model` string and `usage` are preserved. SDK logging defaults to `off` because its debug level prints request bodies. `JEV_INTEGRATION` records what was verified and when.

## packages/cli

Commander-based `jeval` binary. Config is `jeval.config.json` (validated by `config.ts`); commands live in `commands.ts` and are also exported for programmatic use and tests. Mode is always explicit. Output never includes API keys or case content.

## apps/web

Next.js 16 App Router, React 19, Tailwind 4, Geist fonts (self-hosted via the `geist` package so builds do not need network access).

- `/` marketing page with the SDK example (kept identical to `examples/sdk-example.ts` by a test), the embedded demo, use cases, open-source vs Cloud, FAQ, waitlist form.
- `/demo` runs `@jeval/core` in the browser against bundled fixtures. Optional live mode calls `POST /api/demo` with a preset id only; the route requires `DEMO_LIVE_ENABLED=true`, a server-side `TYPESAFE_API_KEY`, `WAITLIST_RATE_LIMIT_SECRET` and Supabase (for the shared rate limiter and daily ceiling); otherwise it answers 503 and the UI keeps live mode disabled.
- `/api/waitlist` → `lib/waitlist/handler.ts` (framework-agnostic) → `SupabaseWaitlistStore` (service role, server only). See `docs/waitlist.md`.
- `robots.ts` disallows everything unless `VERCEL_ENV=production`; `next.config.ts` adds `X-Robots-Tag: noindex` on previews.

## Data flow for one case

1. `EvalCaseSchema.parse` → `buildJudgeState` (evidence only).
2. For each rubric, `planCheck`: skipped (inapplicable) / review (missing evidence) / pending questions.
3. All pending questions → one `provider.judge` call with retries; `validateJudgeResponse` rejects missing or mis-shaped answers as `malformed_response`.
4. Each pending plan's `decide(answers)` → `CheckResult` with status, reason, rule, outcome, probabilities, confidence, evidence.
5. `CaseResult` carries the single `RequestRecord` (model, usage, latency, attempts, request id). Usage is never multiplied by the number of checks.
