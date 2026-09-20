import { DocTitle, docMetadata } from "../doc-page";

export const metadata = docMetadata("limitations");

export default function Page() {
  return (
    <>
      <DocTitle slug="limitations" />
      <div className="prose">
        <h2 id="injection">Prompt injection</h2>
        <p>
          Evaluated text is untrusted input. Every question begins with a preamble that says so, and the example datasets contain cases where the
          assistant output tells the evaluator to pass it. This is a mitigation, not immunity. TypeSafe&apos;s own notes for Jev 1.13 state that the
          model does not treat state as hostile by default. Keep adversarial cases in your held-out set and watch the benchmark; treat a judge that can be
          talked into a pass as a known weakness of your gate. In the one recorded live run, all four adversarial example cases were failed; four cases
          do not measure robustness.
        </p>
        <h2 id="literal">Literal judging</h2>
        <p>
          Jev answers the question you wrote. Vague criteria give vague answers. Put exact conditions in code (tool status, required fields, numbers,
          dates) and reserve the judge for the semantic part.
        </p>
        <h2 id="confidence">Confidence is not accuracy</h2>
        <p>The confidence statistic describes the shape of the probability distribution. A peaked wrong answer is still wrong. Thresholds must be validated on your labelled data.</p>
        <h2 id="labels">Synthetic labels</h2>
        <p>
          The bundled datasets and their expected labels were written for this repository and have not been independently reviewed. They exercise the
          framework; they do not measure Jev.
        </p>
        <h2 id="no-numbers">No performance claims</h2>
        <p>
          The site and docs make no speed, cost or accuracy claims. Cost advantages and judge quality are hypotheses to measure with{" "}
          <code>jeval benchmark</code> on your data. The only cost figure in the repository is a documented list price recorded with its date for
          estimates.
        </p>
        <h2 id="scope">Out of scope in this release</h2>
        <ul>
          <li>Running your application or agent: Jeval evaluates outputs you supply.</li>
          <li>Other judge providers: compare them by importing their results.</li>
          <li>Jeval Cloud, accounts, billing, dashboards, scheduling, a Python SDK: roadmap.</li>
        </ul>
        <h2 id="verified">What has been verified live</h2>
        <p>
          One live smoke test and one live run of both example datasets were recorded on 2026-09-19 through Vercel AI Gateway (see the benchmarking
          page). They show the framework working end to end against real Jev on small synthetic data. All four adversarial cases were failed by the
          judge; that is four cases, not a robustness claim.
        </p>
        <h2 id="unverified">What has not been verified</h2>
        <ul>
          <li>Judging quality on real, human-labelled data. Every label in the repository is synthetic.</li>
          <li>Package publication: names are provisional and nothing is on npm until the release checklist is completed.</li>
        </ul>
      </div>
    </>
  );
}
