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
        <h2 id="automation">The automation curve</h2>
        <p>
          Every decided check carries the probability mass behind each side. The benchmark sweeps a decision threshold from 0.5 to 0.95 and reports,
          for each, what share of checks would be decided automatically and how accurate those decisions were against the labels, with failure
          precision and recall. <code>--target-accuracy 0.9</code> picks the lowest threshold that reaches 90% on at least 20 decided checks and
          tells you what to put in <code>thresholds</code>. This is the honest answer to &ldquo;is the judge accurate?&rdquo;: it depends how much you
          let it decide, and the rest goes to review.
        </p>
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
        <h2 id="recorded">Recorded runs on public, labelled data</h2>
        <p>
          On 2026-09-20 jeval judged 300 responses from <a href="https://github.com/ParticleMedia/RAGTruth" rel="noopener">RAGTruth</a>&apos;s test split
          (human span-level hallucination labels; 50 hallucinated and 50 clean responses each for question answering, summarisation and
          data-to-text) with the <code>claim-support</code> rubric, live via Vercel AI Gateway. Thresholds were fixed on a separate tuning split first.
        </p>
        <table>
          <thead><tr><th>Metric</th><th>Value</th><th>Denominator</th></tr></thead>
          <tbody>
            <tr><td>Failure-detection precision / recall</td><td>82.8% / 78.3%</td><td>191 decided cases (TP 72, FP 15, FN 20, TN 84)</td></tr>
            <tr><td>Abstention (review)</td><td>36.3%</td><td>109 of 300; 58 on hallucinated, 51 on clean</td></tr>
            <tr><td>Execution errors</td><td>0</td><td>300 requests</td></tr>
            <tr><td>Expected calibration error</td><td>0.267</td><td>300 labelled probabilities</td></tr>
            <tr><td>Usage / latency</td><td>398,501 input tokens · p50 353 ms</td><td>estimated $0.017 at the documented rate</td></tr>
          </tbody>
        </table>
        <p>The same run as an automation curve (decide only when the leading side reaches the threshold; the rest is review):</p>
        <table>
          <thead><tr><th>Threshold</th><th>Decided</th><th>Accuracy on decided</th><th>Fail precision / recall</th></tr></thead>
          <tbody>
            <tr><td>0.50</td><td>100%</td><td>71.7%</td><td>72.1% / 70.7%</td></tr>
            <tr><td>0.60</td><td>88%</td><td>75.8%</td><td>78.3% / 67.3%</td></tr>
            <tr><td>0.70</td><td>77%</td><td>81.0%</td><td>82.1% / 64.0%</td></tr>
            <tr><td>0.75</td><td>71%</td><td>82.1%</td><td>83.3% / 60.0%</td></tr>
            <tr><td>0.80</td><td>63%</td><td>81.6%</td><td>82.7% / 54.0%</td></tr>
            <tr><td>0.90</td><td>43%</td><td>89.2%</td><td>89.0% / 43.3%</td></tr>
            <tr><td>0.95</td><td>30%</td><td>95.5%</td><td>94.4% / 34.0%</td></tr>
          </tbody>
        </table>
        <p>
          The same 300 cases judged sentence by sentence with the current default rubric wording (one question per sentence in the same request,
          about 2.5× the tokens): case-level precision 88.3% and recall 98.1% (2 hallucinated responses missed instead of 20), abstaining on 32%,
          and the report names the failing sentence. Against 2,413 human sentence labels: precision 76.7%, recall 89.5%, well-calibrated
          probabilities (ECE 0.08), so a 0.60 threshold decides 96% of sentences at 90% accuracy. The wording and thresholds were chosen on a
          separate tuning split first; the deterministic grounded-values check on the same run flagged 20 responses at 70% precision.
        </p>
        <p>
          Read it as: where the judge decides, it is right about four times in five in both directions, and it abstains on a third of cases. It
          misses subtle conflicts in long summaries (16 of 50 hallucinated summaries judged supported) and over-flags paraphrase in data-to-text
          (12 of 50 clean descriptions judged unsupported). Calibration is poor, which is why thresholds rather than raw probabilities drive
          decisions. One run, one day, one rubric wording; the per-task tables, the tuning decision and the HaluEval and τ-bench runs are in
          <code>examples/public-benchmarks/RESULTS.md</code> in the repository, with a script that reproduces everything for about $0.06.
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
