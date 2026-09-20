import { CodeBlock } from "@/components/code-block";
import { CASE_EXAMPLE } from "@/lib/snippets";
import { DocTitle, docMetadata } from "../doc-page";

export const metadata = docMetadata("cases");

export default function Page() {
  return (
    <>
      <DocTitle slug="cases" />
      <div className="prose">
        <p>A case is one thing to evaluate: what the user said, what the assistant answered, and the evidence needed to judge it. Datasets are JSONL, one case per line.</p>
        <CodeBlock code={CASE_EXAMPLE} lang="json" title="dataset.jsonl (one line, wrapped)" />
        <h2 id="fields">Fields</h2>
        <table>
          <thead><tr><th>Field</th><th>Required</th><th>Sent to judge</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>yes</td><td>no</td><td>Stable slug. Runs are compared and labels aligned by id.</td></tr>
            <tr><td><code>input</code></td><td>yes</td><td>yes, as <code>user_input</code></td><td>The user turn the output responds to.</td></tr>
            <tr><td><code>output</code></td><td>yes</td><td>yes, as <code>assistant_response</code></td><td>The text under evaluation.</td></tr>
            <tr><td><code>messages[]</code></td><td>no</td><td>yes, as <code>conversation</code></td><td>Full transcript with stable message ids and roles (system, user, assistant, tool).</td></tr>
            <tr><td><code>context[]</code></td><td>no</td><td>yes, as <code>reference_material</code></td><td>Retrieved passages or ground truth, each with an id. Required by claim-support.</td></tr>
            <tr><td><code>policy</code></td><td>no</td><td>yes, as <code>policy</code></td><td>Instructions the assistant had to follow. Required by policy-compliance and escalation.</td></tr>
            <tr><td><code>toolEvents[]</code></td><td>no</td><td>yes, as <code>tool_events</code></td><td>Recorded tool calls with id, name, <code>status</code> (success or failure), input, output, error. Exact checks read these fields.</td></tr>
            <tr><td><code>metadata</code></td><td>no</td><td><b>never</b></td><td>Free-form grouping data (scenario, split). Used by applicability rules and reports.</td></tr>
            <tr><td><code>expected</code></td><td>no</td><td><b>never</b></td><td>Provisional labels per rubric id with a <code>source</code> (synthetic, human, imported). Harness data only.</td></tr>
          </tbody>
        </table>
        <h2 id="state">What the judge sees</h2>
        <p>
          <code>buildJudgeState</code> assembles a JSON object with the fields above under fixed names. Every rubric question refers to those names and
          begins with a preamble stating that user and assistant content is untrusted data. The state never contains <code>expected</code> or{" "}
          <code>metadata</code>; a unit test asserts this, and the run report records exactly which fields were shown for each check.
        </p>
        <h2 id="limits">Sizes</h2>
        <p>
          Fields are capped (200k characters for text fields, 500 messages or tool events) by the schema, but Jev&apos;s documented limits are much
          smaller: 32k tokens for state plus the longest question. Keep cases focused; unrelated material lowers judge accuracy.
        </p>
      </div>
    </>
  );
}
