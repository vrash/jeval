# Threshold decision (made on the RAGTruth tuning split only, before any held-out run)

Tuning run: runs/ragtruth.tuning.json (120 cases, default thresholds pass≥0.75 / fail≥0.5, uncovered→review).

Observed: labelled-fail cases had median p(contradicted)=0.46 and p(not_covered)=0.26; labelled-pass cases median p(supported)=0.75. QA hallucinations in RAGTruth are mostly "baseless info" (unsupported additions), which our rubric returns as not_covered → review, so 17 of 20 labelled QA failures abstained.

Decision for all held-out runs:
- claim-support `params.uncoveredIs = "fail"` (RAGTruth's annotation counts unsupported additions as hallucinations), rubric version 1.1.0
- thresholds pass ≥ 0.75, fail ≥ 0.6 (the higher-precision candidate on tuning: TP 32 · FP 3 · FN 5 · TN 28 · review 47; precision 0.914 · recall 0.865)
- concurrency 3, maxAttempts 6 (the tuning run hit HTTP 429 with three datasets in flight)

Simulated alternatives on tuning, for context only: pass≥0.6 / fail≥0.4 gave precision 0.79 · recall 0.86 · review 8. We chose precision over coverage because a false failure in a CI gate costs more than a review.

## Sentence-level rubric (added 2026-09-20, decided on the tuning split before the held-out run)

Tuning run with `granularity: "sentence"` at pass ≥ 0.75 / fail ≥ 0.6: case-level precision 76.5%, recall 94.5%, review 16.7%; sentence-level precision 54.2%, recall 89.1% against span-derived labels (the judge flags neighbouring sentences of an annotated span).

Case-level policy sweep on tuning (fail if any sentence fails, pass if all sentences pass, else review): raising the fail threshold to 0.8 kept recall at 95% and lifted precision from 0.75 to 0.83 at the cost of 25/120 reviews.

Decision for the held-out sentence run: thresholds pass ≥ 0.75, fail ≥ 0.8, `uncoveredIs: fail`, rubric `claim-support` v1.1.0-sentence. Report case-level and sentence-level results, and the automation curve, once.

## Paraphrase wording and second reader (2026-09-20, tuning split only)

Three sentence-level configurations at pass ≥ 0.75 / fail ≥ 0.8 on the 120-case tuning split:

| Config | Case precision | Case recall | Case review | Sentence precision | Sentence recall |
|---|---|---|---|---|---|
| v1.1 wording, 1 reader (simulated from the earlier run's probabilities) | 83% | 95% | 21% | 54% (at fail ≥ 0.6) | 89% |
| v1.2 paraphrase-tolerant wording, 1 reader | 86.0% | 95.6% | 31.7% | 71.9% | 87.5% |
| v1.2 wording, 2 readers (disagreement → review) | 84.6% | 95.7% | 26.7% | 68.3% | 88.4% |

The wording change is the real gain: sentence-level precision +18 points with recall held, at the cost of more case-level reviews. The second reader trims the review rate a little and costs about 2× the question tokens with no precision gain, so it stays an option (`params.readers: 2`) rather than a default.

Decision for the final held-out run: `claim-support` v1.2.0-sentence (paraphrase-tolerant outcomes, `uncoveredIs: fail`, sentence granularity, one reader), thresholds pass ≥ 0.75 / fail ≥ 0.8, plus `grounded-values` v1.0.0 with default value kinds (money, percent, date, time, duration; sources = context, tool events, input). Run once.
