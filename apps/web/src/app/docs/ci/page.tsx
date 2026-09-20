import { CodeBlock } from "@/components/code-block";
import { DocTitle, docMetadata } from "../doc-page";

export const metadata = docMetadata("ci");

export default function Page() {
  return (
    <>
      <DocTitle slug="ci" />
      <div className="prose">
        <h2 id="denominators">Rates and their denominators</h2>
        <table>
          <thead><tr><th>Metric</th><th>Definition</th></tr></thead>
          <tbody>
            <tr><td>Pass rate (decided)</td><td>pass ÷ (pass + fail). Ignores review, skipped and error.</td></tr>
            <tr><td>Pass rate (applicable)</td><td>pass ÷ (all − skipped). Review and error count against it.</td></tr>
            <tr><td>Decided coverage</td><td>(pass + fail) ÷ (all − skipped). How much of the dataset the judge actually decided.</td></tr>
            <tr><td>Review rate, error rate</td><td>review ÷ (all − skipped), error ÷ (all − skipped).</td></tr>
            <tr><td>Critical failures</td><td>Count of failed checks on critical-severity rubrics, always shown separately.</td></tr>
          </tbody>
        </table>
        <p>Usage and latency are recorded per request (one per case), never multiplied by the number of checks in that request.</p>
        <h2 id="exit">Exit codes for <code>jeval run --ci</code></h2>
        <table>
          <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>0</td><td>Every gate met and the run is complete.</td></tr>
            <tr><td>1</td><td>Quality gate failed: failed required checks or critical failures exceed the limits.</td></tr>
            <tr><td>2</td><td>Run incomplete: provider errors, review rate above the limit, coverage below the limit, empty dataset, a required rubric skipped on every case, or a simulated run.</td></tr>
            <tr><td>3</td><td>Usage or configuration error (missing key, invalid config, unreadable files).</td></tr>
          </tbody>
        </table>
        <p>
          The default policy is strict: a review, an error, an empty dataset or a simulated run cannot yield a clean pass. Loosen it deliberately in{" "}
          <code>ci</code> and say why in your repository.
        </p>
        <CodeBlock
          code={`"ci": {
  "maxFailures": 0,            // failed required checks allowed
  "maxCriticalFailures": 0,    // always enforced separately
  "maxReviewRate": 0.1,        // accept up to 10% review on required checks
  "minDecidedCoverage": 0.9,
  "allowErrors": false,
  "allowSkippedRequired": true,  // a required rubric may be inapplicable everywhere
  "allowEmptyDataset": false,
  "allowSimulated": false        // never let fixture runs pass CI
}`}
          lang="json"
        />
        <h2 id="reports">HTML reports</h2>
        <p>
          Self-contained, offline, with no JavaScript. All dataset content is escaped, so an assistant output containing HTML or a script tag is shown as
          text. A simulated run carries a banner; unknown cost is shown as unknown.
        </p>
        <h2 id="ci-example">GitHub Actions</h2>
        <CodeBlock
          code={`- run: pnpm install --frozen-lockfile && pnpm build
- run: pnpm --filter jeval-examples cli            # offline, simulated: framework smoke test
- if: \${{ secrets.TYPESAFE_API_KEY != '' }}
  env: { TYPESAFE_API_KEY: \${{ secrets.TYPESAFE_API_KEY }} }
  run: cd evals && jeval run --mode live --ci        # real gate, only when a key is configured`}
          lang="bash"
        />
      </div>
    </>
  );
}
