import { CodeBlock } from "@/components/code-block";
import { DocTitle, docMetadata } from "../doc-page";

export const metadata = docMetadata("benchmark");

export default function Page() {
  return (
    <>
      <DocTitle slug="benchmark" />
      <div className="prose">
        <p>
          Before trusting a judge on your data, measure it. <code>jeval benchmark</code> compares a run&apos;s predicted statuses with labels you supply
          separately; labels are never sent to the judge.
        </p>
        <CodeBlock
          code={`jeval run --mode live --dataset data/dataset.tuning.jsonl -o runs/tuning.json
jeval benchmark runs/tuning.json --labels data/labels.tuning.jsonl
# adjust thresholds in jeval.config.json, re-run on tuning only, then:
jeval run --mode live --dataset data/dataset.holdout.jsonl -o runs/holdout.json
jeval benchmark runs/holdout.json --labels data/labels.holdout.jsonl --out runs/holdout.benchmark.json`}
          lang="bash"
        />
        <h2 id="metrics">What is reported</h2>
        <ul>
          <li><b>Failure detection</b> over binary labels (pass/fail) where the judge decided: precision, recall, F1 and the confusion counts.</li>
          <li><b>Abstention</b>: how often the judge returned review or skipped on binary labels, split by whether the label was fail or pass.</li>
          <li><b>Undecidable labels</b> (review/skipped) scored separately: did the judge also abstain?</li>
          <li>Execution errors, sample counts, label sources, unmatched labels and unlabelled predictions.</li>
          <li>Latency percentiles and token usage from the run. Simulated runs report neither as a measurement.</li>
          <li><b>Calibration</b> (expected calibration error and bins) only when at least 20 binary-labelled checks carry a single deciding probability; otherwise it says why it was not computed.</li>
        </ul>
        <p>Any metric whose denominator is zero is shown as <code>n/a</code>, never 0 or 100%.</p>
        <h2 id="labels">Labels</h2>
        <CodeBlock code={`{"caseId":"tune-07","rubricId":"claim-support","expected":"fail","source":"human","reviewer":"ana","note":"price contradicts KB"}`} lang="json" title="labels.jsonl" />
        <p>
          The bundled example labels are synthetic and provisional: generated with the cases, not independently human-reviewed. Add human labels with{" "}
          <code>&quot;source&quot;: &quot;human&quot;</code> and a reviewer; the benchmark reports counts by source so you can see how much of your evaluation rests on
          reviewed data.
        </p>
        <h2 id="splits">Tuning versus held-out</h2>
        <p>
          Tune thresholds on the tuning split only. Report numbers from the held-out split only, and do not go back and forth.
        </p>
        <h2 id="recorded">One recorded live run</h2>
        <p>
          On 2026-09-19 both example datasets were judged live by Jev (via Vercel AI Gateway, model id <code>typesafe-ai/jev</code>) with the default
          thresholds. The held-out split, 10 synthetic cases and 50 checks:
        </p>
        <table>
          <thead><tr><th>Metric</th><th>Value</th><th>Denominator</th></tr></thead>
          <tbody>
            <tr><td>Failure detection precision / recall</td><td>100% / 100%</td><td>25 binary labels, all decided (TP 12, FP 0, FN 0, TN 13)</td></tr>
            <tr><td>Abstention on binary labels</td><td>0</td><td>25</td></tr>
            <tr><td>Agreement on undecidable labels</td><td>92%</td><td>23 of 25 labelled review/skipped</td></tr>
            <tr><td>Expected calibration error</td><td>0.047</td><td>22 labelled probabilities</td></tr>
            <tr><td>Usage</td><td>16,919 input tokens, 10 requests</td><td>estimated cost $0.0007 at the documented rate</td></tr>
            <tr><td>Latency</td><td>p50 344 ms, p95 896 ms</td><td>10 requests, one run</td></tr>
          </tbody>
        </table>
        <p>
          Caveats that matter more than the numbers: the labels are synthetic and two of the disagreements look like label errors; the sets are tiny; it
          is one run. The tuning split showed six reviews on labelled passes, pointing at a conservative pass threshold for one custom rubric. The full
          output, the per-case disagreements and the adversarial outcomes are in <code>examples/benchmark.live.md</code> in the repository.
        </p>
        <h2 id="other-judges">Other judges</h2>
        <p>
          To compare Jev with another judge, produce a run JSON in the same report schema from that judge&apos;s output (an import script rather than a new
          provider) and benchmark both against the same held-out labels.
        </p>
      </div>
    </>
  );
}
