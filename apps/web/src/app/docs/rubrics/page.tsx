import { CodeBlock } from "@/components/code-block";
import { StatusBadge } from "@/components/status-badge";
import { RUBRIC_EXAMPLE } from "@/lib/snippets";
import { DocTitle, docMetadata } from "../doc-page";

export const metadata = docMetadata("rubrics");

export default function Page() {
  return (
    <>
      <DocTitle slug="rubrics" />
      <div className="prose">
        <p>
          A rubric is one narrow check with a stable <code>id</code> and <code>version</code>. jeval prefers several small checks to one broad quality
          score: each becomes a single multiple-choice question for Jev, and every question for a case is sent in one request.
        </p>
        <CodeBlock code={RUBRIC_EXAMPLE} lang="json" title="rubrics.json entry" />
        <h2 id="fields">Fields</h2>
        <ul>
          <li><code>id</code>, <code>version</code>: identity. Changing the criterion should bump the version; <code>compare</code> refuses to align results across versions.</li>
          <li><code>kind</code>: one of the five kinds below.</li>
          <li><code>criterion</code>: the question, phrased as one specific condition. Jev is literal: it answers what you wrote.</li>
          <li><code>severity</code>: critical, major or minor. Critical failures are counted separately in every summary so they cannot hide in an average.</li>
          <li><code>required</code> (default true): required checks feed CI gates; optional ones are reported only.</li>
          <li><code>applicability.requires</code>: evidence that must exist (policy, context, toolEvents, messages). Missing evidence yields <StatusBadge status="review" size="sm" />, never a pass.</li>
          <li><code>applicability.onlyWhenMetadata</code>: run only when case metadata matches; otherwise <StatusBadge status="skipped" size="sm" /> with a reason.</li>
          <li><code>thresholds</code>: per-rubric override of the run thresholds.</li>
          <li><code>outcomes</code>: descriptions of the acceptable, unacceptable and insufficient outcomes shown to the judge (required for <code>custom</code>).</li>
          <li><code>params</code>: kind-specific settings.</li>
        </ul>

        <h2 id="kinds">The five kinds</h2>
        <h3>policy-compliance</h3>
        <p>Requires <code>policy</code>. Asks whether <code>assistant_response</code> complies with every applicable rule in <code>policy</code>. Outcomes: acceptable, unacceptable, insufficient_context.</p>
        <h3>claim-support</h3>
        <p>
          Requires <code>context</code>. Asks whether the response&apos;s factual claims (or <code>params.claim</code>) are stated or entailed by{" "}
          <code>reference_material</code>. Outcomes: supported → pass, contradicted → fail, not_covered → review. Set <code>params.uncoveredIs</code> to{" "}
          <code>fail</code> if an uncovered claim should fail in your application.
        </p>
        <h3>tool-claim</h3>
        <p>
          Requires a <code>toolEvents</code> array. Asks only whether the response claims the action (<code>params.action</code>) was completed. Code then
          reads the last event named <code>params.toolName</code>: success → pass, failure → fail, no event → review. If the response makes no claim the
          check is skipped. <code>params.successWhen</code> adds an exact comparison on the tool output, e.g. <code>status = &quot;confirmed&quot;</code>.
          A missing tool log is never treated as proof of failure.
        </p>
        <h3>escalation</h3>
        <p>
          Requires <code>policy</code> and <code>toolEvents</code>. Two questions are batched: does the policy require escalation here, and does the response say
          it escalated. Code then checks for a <code>params.toolName</code> event: required and tool succeeded → pass; required and tool failed → fail;
          required, no event and no statement → fail; required, no event but claimed → review; not required → skipped; unclear → review.
        </p>
        <h3>custom</h3>
        <p>Any natural-language criterion with explicit <code>outcomes</code> descriptions. Outcomes: acceptable, unacceptable, insufficient_context.</p>

        <h2 id="thresholds">From probabilities to statuses</h2>
        <p>For a three-outcome question with probabilities p:</p>
        <ul>
          <li><StatusBadge status="fail" size="sm" /> when p(unacceptable) ≥ <code>thresholds.fail</code>;</li>
          <li>otherwise <StatusBadge status="pass" size="sm" /> when p(acceptable) ≥ <code>thresholds.pass</code>;</li>
          <li>otherwise <StatusBadge status="review" size="sm" />, including whenever the insufficient-context outcome leads.</li>
        </ul>
        <p>
          The configuration is rejected unless <code>pass + fail &gt; 1</code>, which guarantees the two rules can never fire together. The defaults
          (pass 0.75, fail 0.5) are starting points: tune them with <code>jeval benchmark</code> on a tuning split and confirm on held-out data.
          Decisions use the full probability distribution. Jev&apos;s <code>confidence</code> statistic is preserved in results but is not used for
          decisions and is never displayed as an accuracy.
        </p>
        <h2 id="statuses">Statuses</h2>
        <ul>
          <li><StatusBadge status="pass" size="sm" /> / <StatusBadge status="fail" size="sm" />: decided.</li>
          <li><StatusBadge status="review" size="sm" />: undecided; needs a person. Includes missing evidence.</li>
          <li><StatusBadge status="skipped" size="sm" />: explicitly inapplicable, with a reason.</li>
          <li><StatusBadge status="error" size="sm" />: the judge request failed or returned a malformed answer. Execution errors are never counted as evaluated failures.</li>
        </ul>
        <h2 id="explanations">What is shown for each check</h2>
        <p>
          The criterion exactly as sent, the selected outcome, the full probabilities, the provider&apos;s confidence statistic, the rule applied by code (if
          any), and which evidence fields and ids were included. jeval does not invent free-text rationales or quotations: Jev returns decisions, not
          explanations.
        </p>
      </div>
    </>
  );
}
