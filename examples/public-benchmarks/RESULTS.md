# Public benchmark results — recorded 2026-09-20

Real Jev judgments (via Vercel AI Gateway, model id reported as `typesafe-ai/jev`) on public datasets with their own labels. Everything here is one run on one day; probabilities vary slightly between runs, so borderline checks can flip. Reproduce with `bash run.sh` (about $0.06 total). Raw datasets are not committed; `node build.mjs` rebuilds them from the upstream repositories.

## RAGTruth held-out (human span-level hallucination labels) — the primary result

300 responses from RAGTruth's own test split, balanced: 50 hallucinated + 50 clean for each of QA, Summary and Data-to-text. Rubric: `claim-support` v1.1.0 with unsupported additions counted as failures (RAGTruth's definition). Thresholds pass ≥ 0.75, fail ≥ 0.6, chosen on the tuning split beforehand (see TUNING-DECISION.md).

| Metric | Value | Denominator |
|---|---|---|
| Failure-detection precision | 82.8% | 87 predicted failures |
| Failure-detection recall | 78.3% | 92 decided cases labelled hallucinated |
| Confusion | TP 72 · FP 15 · FN 20 · TN 84 | 191 decided of 300 |
| Abstention (review) | 109 (36.3%) | on labelled fail 58, on labelled pass 51 |
| Execution errors | 0 | 300 requests |
| Expected calibration error | 0.267 | 300 samples |
| Usage | 398,501 input tokens, 300 requests | est. $0.0167 at the documented rate |
| Latency | p50 353 ms · p95 634 ms | one run |

Per task (label → judge):

| Task | Hallucinated → fail / review / pass | Clean → pass / review / fail |
|---|---|---|
| QA | 23 / 23 / 4 | 32 / 15 / 3 |
| Summary | 19 / 15 / 16 | 44 / 6 / 0 |
| Data-to-text | 30 / 20 / 0 | 8 / 30 / 12 |

### Automation curve (response-level)

Decide only when the leading side of the distribution reaches the threshold; everything else is review. This is the accuracy-versus-coverage dial that several launch-thread commenters asked for. Scores for this run were derived from the stored probabilities (`uncoveredIs=fail`, so the fail side is contradicted + not_covered).

| threshold | decided | accuracy | fail precision | fail recall |
|---|---|---|---|---|
| 0.50 | 100.0% | 71.7% | 72.1% | 70.7% |
| 0.55 | 92.7% | 74.1% | 76.1% | 68.0% |
| 0.60 | 88.0% | 75.8% | 78.3% | 67.3% |
| 0.65 | 82.0% | 78.5% | 81.0% | 65.3% |
| 0.70 | 77.0% | 81.0% | 82.1% | 64.0% |
| 0.75 | 70.7% | 82.1% | 83.3% | 60.0% |
| 0.80 | 63.3% | 81.6% | 82.7% | 54.0% |
| 0.85 | 55.7% | 86.2% | 85.7% | 52.0% |
| 0.90 | 43.3% | 89.2% | 89.0% | 43.3% |
| 0.95 | 29.7% | 95.5% | 94.4% | 34.0% |
`--target-accuracy 0.9` suggests threshold 0.95: decides 29.7% of checks at 95.5% accuracy; the rest go to review.

What this says:
- Where the judge decides, it is right about four times in five, in both directions. It abstains on roughly a third of cases, evenly across labels.
- Summaries are the weak spot for recall: 16 human-labelled hallucinated summaries were judged supported. RAGTruth's summary hallucinations are often subtle conflicts inside long articles; one whole-response question is too coarse for them. Sentence-level claims would be the next experiment.
- Data-to-text is the weak spot for precision: 12 clean business descriptions were judged unsupported. The references are raw JSON records, and the judge treats reasonable paraphrase ("family-friendly", "affordable") as unsupported addition. Tightening the criterion to exclude evaluative paraphrase is the obvious fix, and would have to be re-validated.
- Calibration is poor (ECE 0.27): the fail probability is directionally right but not a well-calibrated probability of a hallucination. Thresholds, not raw probabilities, should drive decisions, which is how jeval works.

## RAGTruth tuning split (120 cases, default thresholds, uncovered → review)

Used only to choose the policy above. Precision 89.3%, recall 83.3%, review 54 of 120, 5 execution errors (all HTTP 429 from running three datasets concurrently; the held-out runs used concurrency 3 and six attempts and had none).

## RAGTruth held-out, final configuration (v1.2 sentence rubric + grounded values) — the headline result

Same 300 held-out cases and 2,413 human sentence labels, run once with the configuration pre-registered above: `claim-support` v1.2.0-sentence (paraphrase-tolerant wording, sentence granularity, uncovered → fail, one reader), thresholds pass ≥ 0.75 / fail ≥ 0.8, plus `grounded-values`. 300 requests, 991,795 input tokens (~$0.042), p50 363 ms, 0 execution errors.

| Level | Precision | Recall | Confusion | Review |
|---|---|---|---|---|
| Case (300) | 88.3% | 98.1% | TP 106 · FP 14 · FN 2 · TN 83 | 95 (31.7%) |
| Sentence (2,413) | 76.7% | 89.5% | TP 247 · FP 75 · FN 29 · TN 1649 | 413 (17.1%) |

Per task at case level (label → judge): QA hallucinated 43 fail / 7 review / 0 pass, clean 29 pass / 16 review / 5 fail; Summary hallucinated 29 / 21 / 0, clean 33 / 16 / 1; Data-to-text hallucinated 34 / 14 / 2, clean 21 / 21 / 8. Sentence-level calibration: ECE 0.083 over 2117 samples.

Compared with the v1.1 sentence run on the same cases: case-level precision 77.3% → 88.3%, recall 95.3% → 98.1%, sentence-level precision 61.9% → 76.7%. The cost is more case-level reviews (27% → 32%), which is the intended behaviour: the rubric now declines to decide paraphrase-heavy sentences rather than failing them.

Automation curve (sentence level): a 0.60 threshold decides 95.6% of sentences at 90.4% accuracy.

| threshold | decided | accuracy | fail precision | fail recall |
|---|---|---|---|---|
| 0.50 | 100.0% | 88.9% | 61.3% | 86.5% |
| 0.55 | 98.1% | 89.5% | 62.8% | 85.2% |
| 0.60 | 95.6% | 90.4% | 64.9% | 83.4% |
| 0.65 | 93.1% | 91.1% | 66.7% | 80.9% |
| 0.70 | 90.1% | 92.0% | 68.5% | 77.0% |
| 0.75 | 86.5% | 92.7% | 70.0% | 73.2% |
| 0.80 | 83.3% | 93.3% | 72.3% | 71.2% |
| 0.85 | 78.4% | 94.6% | 76.7% | 67.9% |
| 0.90 | 73.4% | 95.4% | 79.6% | 62.8% |
| 0.95 | 64.6% | 96.4% | 84.1% | 55.4% |

Grounded values in the same run: 104 of 300 responses contained a price, date, time, percentage or duration; 20 were flagged, 14 of them in responses labelled hallucinated (70% precision as a proxy; see the grounding section for why RAGTruth is a floor for this check).

## RAGTruth held-out, sentence by sentence, v1.1 wording (superseded by the final configuration above)

Rubric `claim-support` v1.1.0-sentence: one question per sentence in the same request (about 7 per case), thresholds pass ≥ 0.75 / fail ≥ 0.8 fixed on the tuning split (see TUNING-DECISION.md). A case fails if any sentence fails and reviews if any sentence is undecided. Sentence labels are derived from RAGTruth's annotated spans (a sentence is labelled hallucinated if it overlaps a span). 300 requests, 839,659 input tokens (~$0.035, about 2.1× the response-level run), p50 377 ms, 0 execution errors.

| Level | Precision | Recall | Confusion | Review |
|---|---|---|---|---|
| Case (300) | 77.3% | 95.3% | TP 102 · FP 30 · FN 5 · TN 82 | 81 (27%) |
| Sentence (2,413) | 61.9% | 86.9% | TP 219 · FP 135 · FN 33 · TN 1584 | 442 (18%) |

Per task at case level (label → judge): QA hallucinated 40 fail / 10 review / 0 pass, clean 23 pass / 14 review / 13 fail; Summary hallucinated 29 / 18 / 3, clean 33 / 8 / 9; Data-to-text hallucinated 33 / 15 / 2, clean 26 / 16 / 8.

What this says:
- Recall is the point of sentence granularity: 5 hallucinated responses missed instead of 20, and the summary problem from the response-level run (16 misses) drops to 3, because a subtle conflict in one sentence no longer has to win against a paragraph of supported text.
- Precision pays for it (77% vs 83% at case level). At sentence level the judge flags a sentence next to an annotated span about as often as the span itself (135 false sentences), which is partly the coarse span-to-sentence labelling and partly real over-flagging of paraphrase.
- Sentence-level probabilities are much better calibrated than response-level ones (ECE 0.072 vs 0.267 over 2,117 samples), which is why the automation curve below is smooth: at a 0.80 threshold the judge decides 83% of sentences at 90% accuracy.
- The report shows which sentence failed and its probabilities; that is the localisation the "no explanation" objection asks for, without any generated rationale.

Automation curve (sentence level):

| threshold | decided | accuracy | fail precision | fail recall |
|---|---|---|---|---|
| 0.50 | 100.0% | 85.3% | 52.9% | 85.7% |
| 0.55 | 97.6% | 86.4% | 55.1% | 83.9% |
| 0.60 | 95.4% | 87.1% | 56.4% | 82.7% |
| 0.65 | 92.6% | 88.0% | 57.8% | 79.1% |
| 0.70 | 89.4% | 89.1% | 60.1% | 77.6% |
| 0.75 | 86.6% | 89.9% | 62.5% | 75.3% |
| 0.80 | 83.4% | 90.3% | 63.1% | 71.4% |
| 0.85 | 78.8% | 91.1% | 64.5% | 66.8% |
| 0.90 | 73.8% | 92.4% | 67.5% | 61.5% |
| 0.95 | 66.5% | 94.1% | 72.3% | 52.0% |
`--target-accuracy 0.9` suggests threshold 0.80: decides 83.4% at 90.3% accuracy.

## HaluEval QA (paired right / hallucinated answers; labels are model-generated and filtered, not human)

100 HotpotQA-style questions with their supporting knowledge, each as two cases (the right answer labelled pass, the hallucinated answer labelled fail), same rubric and thresholds as RAGTruth. Labels are recorded as `source: imported` because HaluEval generated its hallucinated answers with a model and filtered them; treat these as a sanity check, not a human benchmark.

| Metric | Value | Denominator |
|---|---|---|
| Failure-detection precision / recall | 93.2% / 78.2% | 179 decided of 200 (TP 68 · FP 5 · FN 19 · TN 87) |
| Abstention (review) | 21 (10.5%) | on labelled fail 13, on labelled pass 8 |
| Execution errors | 0 | 200 requests |
| Expected calibration error | 0.193 | 200 samples |
| Usage / latency | 130,664 input tokens · p50 342 ms | est. $0.0055 |

Short, single-claim answers against a short knowledge passage are the easy case for this rubric, which shows in the precision. The misses are hallucinated answers that are plausible restatements of the passage.

Automation curve:

| threshold | decided | accuracy | fail precision | fail recall |
|---|---|---|---|---|
| 0.50 | 100.0% | 84.5% | 92.6% | 75.0% |
| 0.55 | 99.5% | 84.9% | 92.6% | 75.0% |
| 0.60 | 96.0% | 85.4% | 92.4% | 73.0% |
| 0.65 | 94.0% | 85.1% | 92.2% | 71.0% |
| 0.70 | 92.5% | 85.9% | 92.1% | 70.0% |
| 0.75 | 88.0% | 86.9% | 94.3% | 66.0% |
| 0.80 | 86.5% | 87.9% | 95.6% | 65.0% |
| 0.85 | 86.0% | 87.8% | 95.6% | 65.0% |
| 0.90 | 81.5% | 90.2% | 96.9% | 63.0% |
| 0.95 | 72.5% | 93.1% | 96.7% | 59.0% |
`--target-accuracy 0.9` suggests threshold 0.90: decides 81.5% of checks at 90.2% accuracy; the rest go to review.

## Tuning experiments for the final configuration (tuning split only)

| Config (pass ≥ 0.75 / fail ≥ 0.8) | Case precision | Case recall | Case review | Sentence precision | Sentence recall |
|---|---|---|---|---|---|
| v1.1 wording, 1 reader | 83% | 95% | 21% | 54% | 89% |
| v1.2 paraphrase-tolerant wording, 1 reader | 86.0% | 95.6% | 31.7% | 71.9% | 87.5% |
| v1.2 wording, 2 readers | 84.6% | 95.7% | 26.7% | 68.3% | 88.4% |

The paraphrase-tolerant outcome descriptions ("general, evaluative or connective wording that adds no specific fact counts as supported"; "adds a specific fact no passage contains") lifted sentence-level precision by 18 points with recall held. The second reader (same criterion asked twice with independent phrasings, averaged, disagreement → review) trimmed reviews slightly at twice the question tokens and no precision gain; it remains an option, not a default. See TUNING-DECISION.md.

## Grounded values (deterministic, no judge) on RAGTruth

`grounded-values` extracts every price, percentage, date, time and duration from the response and looks its canonical form up in the references, tool events and input. Against RAGTruth's response-level labels (a proxy: RAGTruth counts derived values such as "open 24 hours" or "two options" as correct, this check counts anything not in a source as ungrounded):

| Split | Responses with such values | Flagged | Precision (flagged response is labelled hallucinated) | Recall among responses with values |
|---|---|---|---|---|
| Tuning | 48 of 120 | 14 | 64% | 39% |
| Held-out | 104 of 300 | 20 | 70% | 33% |

The false positives are derived durations ("24 hours" for a business open all day, "seven days" for a week). Bare numbers were excluded from the defaults after measuring them at 67% value-level precision (summaries derive counts). Where a value must be quoted, not derived (prices, appointment times, refund windows), this check is exact by construction; RAGTruth is not that domain, so treat these numbers as a floor.

## τ-bench trajectories (real agent conversations with policy and tool calls; no per-check human labels)

100 recorded gpt-4o trajectories (50 airline, 50 retail) imported with `jeval capture --format chat`: the system prompt becomes the policy (about 6k characters), tool calls and their results become tool events (560 successes, 64 failures across the set). Four rubrics: `policy-compliance`, `booking-claim` (book_reservation), `cancellation-claim` (cancel_reservation), `escalation-handling` (transfer_to_human_agents). No per-check labels exist, so this reports behaviour, not accuracy. 100 requests, 1,071,954 input tokens (~$0.045), p50 499 ms, 0 execution errors, no digesting needed (the longest state fit the budget).

| Rubric | pass | fail | review | skipped |
|---|---|---|---|---|
| policy-compliance | 71 | 11 | 18 | 0 |
| booking-claim | 6 | 0 | 6 | 88 |
| cancellation-claim | 4 | 0 | 12 | 84 |
| escalation-handling | 5 | 0 | 19 | 76 |

What this says:
- The tool-claim checks skip when the final message makes no claim about that action (the common case in a 100-trajectory sample), pass when the claim matches a successful tool event, and review when the claim exists but the matching event was not found or the claim was unclear. No trajectory was caught claiming a booking or cancellation the tools had refused; τ-bench's gpt-4o agent does not make that particular mistake in this sample.
- Policy-compliance failed 11 final responses with p(unacceptable) between 0.51 and 0.89. Task reward is only a weak proxy for policy compliance (a compliant conversation can still fail the task): 7 of 60 reward-0 trajectories and 4 of 40 reward-1 trajectories had a policy failure. Labelling those 11 by hand is the obvious next step; `jeval review runs/taubench.json --labels taubench.human.jsonl --dataset data/taubench.jsonl` does it.
- Cost scales with transcript length: these conversations averaged ~10k input tokens per request, about 25× the RAGTruth QA cases, because the whole policy and conversation travel with every case.
