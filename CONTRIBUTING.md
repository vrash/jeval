# Contributing

Thanks for looking. Jeval is early; small, well-tested changes are the most useful kind.

## Setup

```bash
pnpm install
pnpm check      # lint, typecheck, build, unit tests (offline)
```

Node 22 and pnpm 10 (`packageManager` in package.json). No TypeSafe key is needed for any of the above.

## Ground rules

- **Core stays independent** of React, Next.js, Supabase and the TypeSafe SDK. Provider-specific code lives in `packages/provider-jev`.
- **Never fall back silently.** A failed real provider must surface as `error`; the fixture provider is only ever chosen explicitly.
- **Expected labels and metadata are never sent to the judge.** A test asserts this; keep it green.
- **Usage is per request.** Do not attribute one batched request's tokens to several checks.
- **No invented rationales.** Reports show the criterion, the selected outcome, probabilities, the rule applied in code and the evidence ids. Nothing more.
- **Escape everything** that ends up in HTML reports or the website.
- **No telemetry, no performance claims, no fabricated numbers.** Benchmarks come from recorded runs or are labelled simulated.

## Making a change

1. Add or update a test in the package you touch (`vitest`), or an e2e test for site journeys (`apps/web/e2e`).
2. If you change a rubric's criterion, bump its `version`; `compare` refuses to align across versions.
3. Run `pnpm check`. For CLI or export changes also run `pnpm verify:packed`.
4. Keep generated runs, `.env` files and credentials out of commits (`.gitignore` covers the usual paths).

## Reporting judge behaviour

If Jev decides something surprising on the example data, open an issue with the case id, rubric id, the probabilities from the run JSON and what you expected. Do not paste real customer data.
