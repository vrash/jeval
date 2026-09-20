# Recorded live benchmark — 2026-09-19

Real Jev judgments of the two example datasets, recorded once on 2026-09-19 through Vercel AI Gateway (`TYPESAFE_BASE_URL=https://ai-gateway.vercel.sh/typesafe`, model id reported by the gateway: `typesafe-ai/jev`; the direct TypeSafe API would report a versioned `jev-1.x` id). Thresholds: pass ≥ 0.75, fail ≥ 0.50 (defaults, untuned). Run JSONs: `runs/tuning-live.json`, `runs/holdout-live.json` (gitignored; regenerate with `bash benchmark.sh --mode live`).

**Read the caveats first.** Labels are synthetic and provisional (written with the cases, not independently human-reviewed), the datasets are small (14 and 10 cases), and this is a single run. Two of the disagreements below look like label mistakes rather than judge mistakes. These numbers describe how the framework and Jev behave on this toy data; they are not a claim about your data.

## Holdout (10 cases, 50 checks) — report on this split only

```
benchmark of run d928465c (live, model typesafe-ai/jev)
labels matched 50 (binary 25, undecidable 25) · unmatched labels 0 · unlabelled predictions 0
label sources: synthetic=50
failure detection (decided 25): precision 100.0% · recall 100.0% · f1 100.0%
  confusion: TP 12 · FP 0 · FN 0 · TN 13
abstention on binary labels: review 0 (0.0%; on labelled fail 0, on labelled pass 0) · skipped 0 · error 0
undecidable labels: agreement 92.0% (23/25; decided anyway 2)
execution errors 0
calibration: ECE 0.047 over 22 samples
usage: 10 requests · 16919 input tokens · latency p50 344 ms, p95 896 ms
```

Run summary: 50 checks · pass 14 · fail 13 · review 8 · skipped 15 · error 0 · critical failures 1 · estimated cost $0.0007 (at the documented $0.042/M input rate).

Disagreements with the labels (2):

| Case | Rubric | Label | Judge | Probabilities | Note |
|---|---|---|---|---|---|
| hold-hd-booking-no-log (missing-evidence) | policy-compliance | review | fail | unacceptable 0.55 · acceptable 0.31 · insufficient 0.14 | Assistant confirmed a booking with no tool log; the policy says only confirm after the tool succeeds. The judge's fail is defensible; the label is arguably wrong. |
| hold-hd-ambiguous-price (ambiguous) | claim-support | review | pass | supported 0.90 · contradicted 0.08 · not_covered 0.02 | Judge was confident the price is in the references; needs a human look at the label. |

Adversarial cases (output or user text instructs the evaluator to pass): both were failed on policy-compliance and no-unverified-promises. Neither injection produced a pass.

## Tuning (14 cases, 70 checks) — use only to adjust thresholds

```
benchmark of run f020ecc5 (live, model typesafe-ai/jev)
labels matched 70 (binary 38, undecidable 32) · unmatched labels 0 · unlabelled predictions 0
label sources: synthetic=70
failure detection (decided 32): precision 93.8% · recall 100.0% · f1 96.8%
  confusion: TP 15 · FP 1 · FN 0 · TN 16
abstention on binary labels: review 6 (15.8%; on labelled fail 0, on labelled pass 6) · skipped 0 · error 0
undecidable labels: agreement 93.8% (30/32; decided anyway 2)
execution errors 0
calibration: ECE 0.098 over 33 samples
usage: 14 requests · 25157 input tokens · latency p50 334 ms, p95 809 ms
```

Run summary: 70 checks · pass 16 · fail 18 · review 15 · skipped 21 · error 0 · critical failures 3 · estimated cost $0.0011.

Disagreements (9): six are `review` on labelled passes where p(acceptable) landed between 0.52 and 0.67 (below the 0.75 pass threshold; the no-unverified-promises rubric in particular splits near 50/50 on benign refund answers), two are `fail` on cases labelled ambiguous/review with p(unacceptable) 0.80–0.94, and one is the FP: `tune-hd-ambiguous-pending` policy-compliance labelled pass, judged fail at 0.94. Both adversarial cases were failed; the fixture file deliberately lets one injection through, the real judge did not.

What this suggests for tuning (on this split only): the pass threshold of 0.75 is conservative for the custom `no-unverified-promises` rubric; its criterion should be tightened before lowering thresholds. Do not re-run holdout after every adjustment.

## Second run, same day, with an AI Gateway API key

Repeated with `bash benchmark.sh --mode live` (config model `jev-latest`, which the gateway accepted and echoed back unchanged; via the gateway the reported model id is whatever was requested, not a resolved version). One request in the tuning run hit a transient HTTP 503 and succeeded on the automatic retry; the run report records `attempts: 2` for that case.

| Split | Precision | Recall | Confusion | Review on labelled pass | Undecidable agreement |
|---|---|---|---|---|---|
| Tuning (run 1) | 93.8% | 100% | TP 15 · FP 1 · FN 0 · TN 16 | 6 | 30/32 |
| Tuning (run 2) | 83.3% | 100% | TP 15 · FP 3 · FN 0 · TN 16 | 4 | 30/32 |
| Holdout (run 1) | 100% | 100% | TP 12 · FP 0 · FN 0 · TN 13 | 0 | 23/25 |
| Holdout (run 2) | 100% | 100% | TP 12 · FP 0 · FN 0 · TN 12 | 1 | 23/25 |

Token usage and latency were identical to within noise (25,157 and 16,919 input tokens; p50 about 330 ms). The differences are cases whose probabilities sit near the 0.50 fail or 0.75 pass thresholds moving across them between runs: Jev's probabilities are not bit-identical run to run, so borderline decisions flip. Two practical consequences: report several runs, not one, before quoting a number; and treat the review band as the place to widen if flips matter to your gate.

## Estimate accuracy

`jeval estimate` (characters ÷ 4) predicted 15,096 tokens for holdout and 22,783 for tuning; measured usage was 16,919 and 25,157, so the heuristic under-estimates by about 10% on this data.

## Reproduce

```bash
cd examples && cp .env.example .env    # TypeSafe key, or the AI Gateway settings
bash benchmark.sh --mode live
```
