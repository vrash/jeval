# Limitations

Honest boundaries of this release. Also published at `/docs/limitations` on the site.

## Prompt injection is mitigated, not solved

Every question carries a preamble declaring the user and assistant fields untrusted, and the example datasets include four adversarial cases where the evaluated text instructs the evaluator to pass it. TypeSafe documents that Jev 1.13 "does not treat state as hostile by default". The fixtures in `examples/data/fixtures.json` deliberately let two adversarial cases through so the simulated benchmark shows what a miss looks like. In the recorded live run (`examples/benchmark.live.md`), all four adversarial cases were failed by Jev; that is four cases, not a measurement of robustness.

## Jev is literal and text-only

It answers the question as written, does not do arithmetic or date comparison reliably, and accepts text only. Keep exact checks in code. Large irrelevant state lowers accuracy; keep cases focused (documented limit: 32k tokens for state plus the longest question).

## Confidence is a distribution statistic

Preserved but never used for decisions or shown as accuracy. Thresholds operate on the probabilities and must be validated on labelled data.

## Labels are synthetic and provisional

All expected labels in `examples/` were authored with the cases for this repository. None have been independently human-reviewed. They exercise the framework; they do not measure Jev. Add `source: "human"` labels with a reviewer before drawing conclusions.

## No performance, cost or adoption claims

None are made. The single price figure in the repository is TypeSafe's documented input rate on 2026-09-19, stored with its date and used only for labelled estimates.

## What has been verified live

One live smoke test and one live run of both example datasets were recorded on 2026-09-19 through Vercel AI Gateway (`examples/benchmark.live.md`). They show the framework working end to end against real Jev on small synthetic data; they are not a measurement of Jev on your data.

## Run-to-run variance

Two live runs of the same datasets on the same day disagreed on a handful of borderline checks (see `examples/benchmark.live.md`): Jev's probabilities vary slightly between calls, and checks sitting near a threshold flip. Quote numbers from several runs, and expect a strict CI gate to be sensitive to this on borderline cases.

## Still unverified

- Judging quality on real, human-labelled data. All labels in this repository are synthetic.
- The direct TypeSafe API path (versioned `jev-1.x` model ids) has only been exercised via the gateway; the adapter is the same, the credential differs.
- The live public demo path (`/api/demo` with `DEMO_LIVE_ENABLED=true`) has been exercised only with the route's disabled path in tests.

## Out of scope in this release

Running agents or applications; other judge providers (compare by importing their reports into the run schema); Jeval Cloud, accounts, billing, dashboards, scheduling, enterprise controls, a Python SDK.
