# Public benchmarks

Runs jeval against public datasets that carry their own labels, so the judge is measured on data we did not write. Results with all caveats: `RESULTS.md`. The threshold decision made before the held-out runs: `TUNING-DECISION.md`.

| Source | Licence | What we use | Label source | Rubric |
|---|---|---|---|---|
| [RAGTruth](https://github.com/ParticleMedia/RAGTruth) | MIT | test split: 50 hallucinated + 50 clean responses each for QA, Summary, Data-to-text (300); a 120-case tuning sample from the train split | human span-level annotations | `claim-support` v1.1.0 (unsupported additions count as failures) |
| [HaluEval](https://github.com/RUCAIBox/HaluEval) | MIT | 100 QA samples → 200 cases (right answer = pass, hallucinated answer = fail), knowledge as reference | model-generated and filtered, recorded as `source: imported` | `claim-support` v1.1.0 |
| [τ-bench](https://github.com/sierra-research/tau-bench) | MIT | 100 recorded gpt-4o trajectories (50 airline, 50 retail) imported with `jeval capture --format chat`; policy = the system prompt, tool calls linked to results | none per check (task reward only) | `policy-compliance`, two `tool-claim`, `escalation` |

Only the scripts, configs, rubrics and benchmark summaries are committed. `raw/` (upstream clones, ~365 MB) and `data/` (built datasets, ~6 MB) are rebuilt by `run.sh`; run reports land in `runs/` and are gitignored because they contain the dataset text.

```bash
pnpm build                         # from the repo root
cp examples/.env examples/public-benchmarks/.env   # or create one with the gateway settings
bash examples/public-benchmarks/run.sh
```

Protocol: thresholds and rubric parameters are chosen on the RAGTruth tuning split only, written down in `TUNING-DECISION.md`, then each held-out set is run once. If you change a rubric, bump its version and re-run the tuning split before touching the held-out sets again.
