## What

<!-- One or two sentences. Link the issue: "Closes #123". -->

## Why

<!-- The problem this solves. For judge behaviour changes, include before/after outcomes on the example datasets. -->

## Checklist

- [ ] `pnpm check` passes (lint, typecheck, build, unit tests)
- [ ] Tests added or updated for the change (`vitest` in the package, or `apps/web/e2e` for site journeys)
- [ ] Rubric `version` bumped if a criterion, outcome text, params or thresholds changed
- [ ] Docs updated (`docs/`, `README.md`, or the site's `apps/web/src/app/docs`) where behaviour changed
- [ ] No secrets, `.env` files, run reports or real customer data in the diff
- [ ] Expected labels and metadata are still never sent to the judge (`pnpm --filter @jeval/core test` covers this)

## Notes for reviewers

<!-- Anything unusual: new dependencies, migrations, breaking changes to the run report schema. -->
