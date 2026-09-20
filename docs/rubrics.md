# Rubric guide

A rubric is one narrow question with a stable identity. Prefer several small rubrics to one "overall quality" score: small questions are easier for Jev to answer literally, easier to label, and easier to gate on.

## Anatomy

```json
{
  "id": "refund-policy",
  "version": "1.0.0",
  "kind": "policy-compliance",
  "severity": "major",
  "required": true,
  "description": "Refund answers follow the refund section of the policy.",
  "criterion": "Does the response state refund conditions that match the policy's refund rules exactly (window, receipt requirement)?",
  "applicability": { "requires": ["policy"], "onlyWhenMetadata": { "topic": "refunds" } },
  "thresholds": { "pass": 0.8, "fail": 0.5 }
}
```

- Bump `version` whenever `criterion`, `outcomes`, `params` or thresholds change. `jeval compare` treats a rubric with a different version or fingerprint as not comparable.
- `severity: critical` failures are counted separately in every summary and gate; use it for anything that must never ship (false action confirmations, missed escalations).
- `required: false` rubrics are reported but do not affect CI exit codes.

## Choosing a kind

| Situation | Kind | Deterministic part |
|---|---|---|
| Must follow written instructions | `policy-compliance` | requires `policy` |
| States facts that must come from supplied references | `claim-support` | requires `context`; `not_covered` → review (or fail with `params.uncoveredIs`); `params.granularity: "sentence"` judges each sentence separately and reports which failed |
| Claims an action happened (booking, refund issued, ticket created) | `tool-claim` | reads the last `params.toolName` event's `status` and optional `successWhen` on its output |
| Policy sometimes requires a hand-off | `escalation` | reads the `params.toolName` event; two batched questions |
| Anything else with clear acceptable/unacceptable descriptions | `custom` | none |
| Prices, dates, times, durations, percentages must come from the sources | `grounded-values` | entirely deterministic: extracts each value from the output and matches its canonical form (2pm = 14:00, 12% = 12 percent, "20 May" = 2024-05-20) against references, tool events, input and policy; no judge request. Bare numbers are opt-in via `params.valueKinds` because summaries derive counts legitimately |

Put exact conditions in code, not in the criterion: tool status, ids, amounts, dates. Jev reads dates as text and does not do arithmetic reliably (TypeSafe's own guidance for Jev 1.13).

## Second reader

`params.readers: 2` on a policy, custom or claim check asks the criterion twice in the same request with an independently phrased second instruction, decides on the averaged probabilities, and forces `review` when the two readers reach opposite decisions. It costs the extra question tokens only (the state is sent once) and is the pattern the one published production study of Jev-based verification recommends.

## Writing the criterion

- One condition per rubric. "Is the refund window stated correctly?" beats "Is the answer good?".
- Refer to state fields by name when it helps: `assistant_response`, `policy`, `reference_material`, `tool_events`.
- Describe the three outcomes explicitly for `custom` rubrics. The insufficient outcome is what makes review possible; without it the judge is forced to guess.
- Do not ask the judge to trust anything inside the evaluated text. The untrusted-data preamble is prepended automatically; it is a mitigation, not immunity.

## Thresholds

Defaults: pass ≥ 0.75, fail ≥ 0.5. They are starting points.

1. Run the tuning split live: `jeval run --mode live --dataset data/dataset.tuning.jsonl`.
2. `jeval benchmark` it against `labels.tuning.jsonl`. Look at precision/recall of failure detection and the review rate on labelled fails versus labelled passes.
3. Adjust thresholds (globally in the config, or per rubric) and repeat on the tuning split only.
4. Run and benchmark the held-out split once. Report those numbers.

Raising `fail` reduces false failures but pushes borderline cases to review. Raising `pass` does the same on the other side. Review is not free: a strict CI policy treats it as incomplete.

## Turning reviews into labels

`jeval review runs/<run>.json --labels human.jsonl --dataset dataset.jsonl` walks each `review` result and appends a `LabelRecord` with `source: "human"`. Feed that file to `jeval benchmark`; it reports label counts by source so you can see how much of a number rests on reviewed data.

## Statuses and what to do with them

- `pass` / `fail`: decided by the rules above.
- `review`: look at it. The report shows the probabilities and which evidence was present; often the fix is supplying the missing tool log or reference.
- `skipped`: the rubric did not apply (metadata mismatch, no claim made, policy did not require escalation). Reported with a reason.
- `error`: the provider failed or returned a malformed answer after retries. Fix the run, do not count it.
