import { CodeBlock } from "@/components/code-block";
import { DocTitle, docMetadata } from "../doc-page";

export const metadata = docMetadata("cli");

export default function Page() {
  return (
    <>
      <DocTitle slug="cli" />
      <div className="prose">
        <p>
          The CLI ships as <code>@jeval/cli</code> with a <code>jeval</code> executable. Commands print nothing sensitive by default: no API keys and no
          case content unless you pass <code>--show</code>.
        </p>
        <h2 id="init">jeval init [dir]</h2>
        <p>Creates <code>jeval.config.json</code>, <code>rubrics.json</code>, <code>dataset.jsonl</code>, <code>fixtures.json</code>, <code>.env.example</code> and a README. Existing files are kept.</p>
        <h2 id="capture">jeval capture traces.jsonl -o dataset.jsonl</h2>
        <p>
          Turns exported traces into cases so you can evaluate last week&apos;s real conversations. Formats: OpenAI-style chat message arrays (with
          tool calls and tool results linked into tool events), OpenTelemetry GenAI spans (JSONL or OTLP envelopes), Langfuse traces with
          observations, LangWatch traces with spans, or <code>--format generic --map input=path --map output=path …</code> for anything else.
          <code>--format auto</code> sniffs the shape. The first system message becomes the policy unless <code>--policy-file</code> is given. Tool
          failure is inferred from explicit error levels, or from outputs that look like errors; pass <code>--no-tool-status-heuristic</code> to
          drop events whose status the source does not state. Which fields were verified against each vendor&apos;s documentation and which were inferred is
          recorded in the repository&apos;s <code>docs/import-formats.md</code>.
        </p>
        <CodeBlock
          code={`jeval capture exports/langfuse-traces.json -o data/last-week.jsonl --metadata-fields userId,tags
jeval estimate --dataset data/last-week.jsonl
jeval run --mode live --dataset data/last-week.jsonl --limit 5 --show`}
          lang="bash"
        />
        <h2 id="run">jeval run --mode fixture|live</h2>
        <CodeBlock
          code={`jeval run --mode fixture --html                 # simulated, offline, labelled SIMULATED
jeval run --mode live --model jev-1.13.0 --ci   # real Jev; exit code follows the CI policy
jeval run --mode live --concurrency 8 --timeout-ms 20000 --max-attempts 3 --label commit=$GIT_SHA`}
          lang="bash"
        />
        <p>
          Mode is always explicit. Every case&apos;s questions go in one request; transient provider errors (rate limits, timeouts, 5xx) are retried with
          backoff and Retry-After up to <code>maxAttempts</code>; other errors are recorded on the case and the run continues. Ctrl-C cancels remaining
          cases and still writes the report. Output is <code>runs/run-&lt;timestamp&gt;-&lt;mode&gt;.json</code> plus HTML with <code>--html</code>.
        </p>
        <h3 id="sample">Sample before you scale</h3>
        <CodeBlock
          code={`jeval estimate                              # requests, input tokens and cost, nothing sent
jeval run --mode live --limit 5 --show      # judge five cases and print the judged state beside each verdict
jeval run --mode live --max-usd 0.50        # refuse to start if the estimate exceeds the budget`}
          lang="bash"
        />
        <p>
          <code>estimate</code> builds the exact state and questions a run would send and sizes them with a character heuristic (characters ÷ 4). It
          is not a tokenizer; on the example datasets it under-estimated measured usage by about 10%. Compare it with a small live run on your own data. Cost is priced from the <code>pricing</code> entry in your config
          and shown as an estimate, or reported as unknown.
        </p>
        <h3 id="digest">Long conversations</h3>
        <p>
          States above the digest budget (110,000 characters by default, roughly 27k tokens, under Jev&apos;s documented 32k state limit) are shortened
          before sending: the earliest and latest turns are kept (25% / 75% of the budget), the omitted middle is replaced by one marker message, and
          oversized text fields are cut with a visible note. What was omitted is recorded on every check&apos;s evidence. Configure with{" "}
          <code>&quot;digest&quot;: {"{"} &quot;maxChars&quot;: 60000 {"}"}</code> or disable with <code>&quot;digest&quot;: false</code>.
        </p>
        <h2 id="review">jeval review run.json --labels human.jsonl</h2>
        <p>
          Walks every <code>review</code> result (or <code>--statuses review,fail</code>), shows the reason, the probabilities and, with{" "}
          <code>--dataset</code>, the judged input and output, and records your decision as a label with <code>source: human</code> and your reviewer
          name. Already-labelled checks are skipped, so you can stop and resume. The labels file feeds <code>jeval benchmark</code> directly, which reports
          how much of a benchmark rests on human versus synthetic labels.
        </p>
        <h2 id="report">jeval report run.json</h2>
        <p>Renders a self-contained HTML file: no scripts, a strict Content-Security-Policy, every string escaped. Cases with critical failures are listed first.</p>
        <h2 id="compare">jeval compare baseline.json candidate.json</h2>
        <p>
          Aligns checks by case id and rubric id, listing new failures, resolved failures, new reviews and new errors. Different datasets, rubric versions,
          models, thresholds or modes are flagged; changed rubrics and mixed simulated/live runs are treated as not comparable (exit 2). Add{" "}
          <code>--fail-on-new</code> to exit 1 on new failures.
        </p>
        <h2 id="benchmark">jeval benchmark run.json --labels labels.jsonl</h2>
        <p>
          Scores predicted statuses against separately supplied labels, prints the automation curve, and with <code>--target-accuracy 0.9</code>
          suggests a threshold. Sentence-level checks can be labelled per sentence with rubric ids of the form <code>claim-support#s3</code>. See the
          benchmarking page.
        </p>
        <h2 id="labels">jeval labels dataset.jsonl --out labels.jsonl</h2>
        <p>Extracts the provisional <code>expected</code> entries embedded in a dataset into a labels file, so labels and predictions stay separate.</p>
        <h2 id="config">jeval.config.json</h2>
        <CodeBlock
          code={`{
  "dataset": "./dataset.jsonl",
  "rubrics": "./rubrics.json",
  "output": "./runs",
  "provider": { "model": "jev-latest", "fixtures": "./fixtures.json", "strictFixtures": false },
  "thresholds": { "pass": 0.75, "fail": 0.5 },
  "concurrency": 4, "timeoutMs": 30000, "maxAttempts": 3,
  "pricing": { "inputPerMillionTokensUsd": 0.042, "asOf": "2026-09-19", "source": "https://docs.typesafe.ai/models" },
  "ci": { "maxFailures": 0, "maxReviewRate": 0, "minDecidedCoverage": 1, "allowSimulated": false }
}`}
          lang="json"
        />
        <p>
          <code>pricing</code> is optional. When present, cost is reported as an estimate with the rate and its date; when absent, cost is reported as
          unknown, never as zero. Fixture runs never report a cost.
        </p>
      </div>
    </>
  );
}
