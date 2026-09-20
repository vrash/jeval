import { describe, expect, it } from "vitest";
import { benchmarkRun } from "../benchmark.js";
import { compareRuns } from "../compare.js";
import { evaluateDataset } from "../evaluate.js";
import { EXIT, evaluateGates } from "../gates.js";
import { escapeHtml, renderComparisonHtml, renderRunHtml } from "../html.js";
import { parseCasesJsonl, parseLabelsJsonl } from "../jsonl.js";
import { parseRubric } from "../schemas.js";
import { answer, bookingRubric, customRubric, makeCase, policyRubric, ScriptedProvider } from "./helpers.js";

const ok = answer({ acceptable: 0.9, unacceptable: 0.05, insufficient_context: 0.05 });
const bad = answer({ acceptable: 0.05, unacceptable: 0.9, insufficient_context: 0.05 });
const meh = answer({ acceptable: 0.4, unacceptable: 0.2, insufficient_context: 0.4 });

async function run(script: Record<string, Record<string, ReturnType<typeof answer>>>, ids = Object.keys(script)) {
  const provider = new ScriptedProvider((req) => script[req.meta!.caseId!]!);
  return evaluateDataset(
    ids.map((id) => makeCase({ id })),
    [policyRubric, customRubric],
    { provider },
  );
}

describe("CI gates", () => {
  it("passes a clean live run", async () => {
    const report = await run({ a: { policy: ok, tone: ok }, b: { policy: ok, tone: ok } });
    const g = evaluateGates(report);
    expect(g.exitCode).toBe(EXIT.ok);
  });
  it("fails the gate on a failed required check", async () => {
    const report = await run({ a: { policy: bad, tone: ok } });
    const g = evaluateGates(report);
    expect(g.exitCode).toBe(EXIT.gateFailed);
    expect(g.reasons[0]).toMatch(/failed required check/);
  });
  it("is incomplete on review, error, empty dataset, or skipped required rubric", async () => {
    const review = await run({ a: { policy: meh, tone: ok } });
    expect(evaluateGates(review).exitCode).toBe(EXIT.incomplete);
    expect(evaluateGates(review, { maxReviewRate: 0.5, minDecidedCoverage: 0.5 }).exitCode).toBe(EXIT.ok);

    const provider = new ScriptedProvider(() => new Error("down"));
    const errored = await evaluateDataset([makeCase()], [policyRubric], { provider, maxAttempts: 1 });
    expect(evaluateGates(errored).exitCode).toBe(EXIT.incomplete);
    expect(evaluateGates(errored, { allowErrors: true }).exitCode).toBe(EXIT.incomplete); // coverage still short
    expect(evaluateGates(errored, { allowErrors: true, minDecidedCoverage: 0 }).exitCode).toBe(EXIT.ok);

    const empty = await evaluateDataset([], [policyRubric], { provider });
    expect(evaluateGates(empty).exitCode).toBe(EXIT.incomplete);
    expect(evaluateGates(empty, { allowEmptyDataset: true }).exitCode).toBe(EXIT.ok);

    const skipProvider = new ScriptedProvider(() => ({ "booking.claim": answer({ claims_completed: 0.05, does_not_claim: 0.9, unclear: 0.05 }) }));
    const skipped = await evaluateDataset([makeCase({ toolEvents: [] })], [bookingRubric], { provider: skipProvider });
    expect(evaluateGates(skipped).reasons[0]).toMatch(/skipped on every case/);
    expect(evaluateGates(skipped, { allowSkippedRequired: true }).exitCode).toBe(EXIT.ok);
  });
  it("critical failure trips the gate even when maxFailures allows it", async () => {
    const provider = new ScriptedProvider(() => ({ "booking.claim": answer({ claims_completed: 0.95, does_not_claim: 0.03, unclear: 0.02 }) }));
    const report = await evaluateDataset([makeCase({ toolEvents: [{ id: "t", name: "book_appointment", status: "failure" }] })], [bookingRubric], { provider });
    const g = evaluateGates(report, { maxFailures: 5 });
    expect(g.exitCode).toBe(EXIT.gateFailed);
    expect(g.reasons[0]).toMatch(/critical/);
  });
  it("optional rubrics do not gate", async () => {
    const optional = parseRubric({ ...customRubric, required: false });
    const provider = new ScriptedProvider(() => ({ policy: ok, tone: bad }));
    const report = await evaluateDataset([makeCase()], [policyRubric, optional], { provider });
    expect(evaluateGates(report).exitCode).toBe(EXIT.ok);
  });
  it("simulated runs are incomplete unless explicitly allowed", async () => {
    const report = await run({ a: { policy: ok, tone: ok } });
    const simulated = { ...report, simulated: true, mode: "fixture" as const };
    expect(evaluateGates(simulated).exitCode).toBe(EXIT.incomplete);
    expect(evaluateGates(simulated, { allowSimulated: true }).exitCode).toBe(EXIT.ok);
  });
});

describe("compareRuns", () => {
  it("finds new and resolved failures on aligned ids and flags incompatibilities", async () => {
    const before = await run({ a: { policy: ok, tone: bad }, b: { policy: bad, tone: ok } });
    const after = await run({ a: { policy: bad, tone: ok }, b: { policy: bad, tone: ok }, c: { policy: ok, tone: ok } });
    const cmp = compareRuns(before, after);
    expect(cmp.newFailures.map((t) => `${t.caseId}/${t.rubricId}`)).toEqual(["a/policy"]);
    expect(cmp.resolvedFailures.map((t) => `${t.caseId}/${t.rubricId}`)).toEqual(["a/tone"]);
    expect(cmp.unchanged).toBe(2);
    expect(cmp.alignment.onlyInCandidate).toEqual(["c"]);
    expect(cmp.compatibility.issues.some((i) => i.field === "dataset")).toBe(true);
    expect(cmp.compatibility.compatible).toBe(true);
  });
  it("marks changed rubrics and mixed modes as not comparable", async () => {
    const before = await run({ a: { policy: ok, tone: ok } });
    const after = { ...before, mode: "fixture" as const, rubrics: before.rubrics.map((r) => (r.id === "tone" ? { ...r, version: "2", fingerprint: "x" } : r)) };
    const cmp = compareRuns(before, after);
    expect(cmp.compatibility.compatible).toBe(false);
    expect(cmp.alignment.sharedRubrics).toEqual(["policy"]);
    expect(cmp.compatibility.issues.map((i) => i.field).sort()).toEqual(["mode", "rubrics"]);
  });
});

describe("benchmarkRun", () => {
  it("computes precision/recall, abstention and undefined metrics honestly", async () => {
    const report = await run({ a: { policy: bad, tone: ok }, b: { policy: ok, tone: meh }, c: { policy: bad, tone: bad } });
    const labels = parseLabelsJsonl(
      [
        { caseId: "a", rubricId: "policy", expected: "fail", source: "human" },
        { caseId: "b", rubricId: "policy", expected: "pass" },
        { caseId: "b", rubricId: "tone", expected: "review" },
        { caseId: "c", rubricId: "policy", expected: "pass" },
        { caseId: "c", rubricId: "tone", expected: "fail" },
        { caseId: "zzz", rubricId: "tone", expected: "fail" },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
    ).labels;
    const b = benchmarkRun(report, labels);
    expect(b.sampleCount).toBe(5);
    expect(b.labelsWithoutPrediction).toBe(1);
    expect(b.predictionsWithoutLabel).toBe(1);
    expect(b.binaryLabelCount).toBe(4);
    expect(b.undecidableLabelCount).toBe(1);
    expect(b.failureDetection.confusion).toEqual({ truePositive: 2, falsePositive: 1, falseNegative: 0, trueNegative: 1 });
    expect(b.failureDetection.precision).toBeCloseTo(2 / 3);
    expect(b.failureDetection.recall).toBe(1);
    expect(b.undecidable.agreementRate).toBe(1);
    expect(b.labelSources).toEqual({ human: 1, synthetic: 4 });
    expect(b.calibration.computed).toBe(false);
    expect(b.calibration.reason).toMatch(/at least 20/);
  });
  it("returns null metrics with zero denominators", async () => {
    const report = await run({ a: { policy: meh, tone: meh } });
    const b = benchmarkRun(report, parseLabelsJsonl('{"caseId":"a","rubricId":"policy","expected":"fail"}').labels);
    expect(b.failureDetection.precision).toBeNull();
    expect(b.failureDetection.recall).toBeNull();
    expect(b.abstention.reviewOnLabelledFail).toBe(1);
    expect(b.undecidable.agreementRate).toBeNull();
  });
  it("computes calibration bins when enough labelled probabilities exist", async () => {
    const script: Record<string, Record<string, ReturnType<typeof answer>>> = {};
    const labels = [];
    for (let i = 0; i < 24; i++) {
      const p = i / 23;
      script[`c${i}`] = { policy: answer({ acceptable: 1 - p, unacceptable: p, insufficient_context: 0 }), tone: ok };
      labels.push(JSON.stringify({ caseId: `c${i}`, rubricId: "policy", expected: p > 0.5 ? "fail" : "pass" }));
    }
    const report = await run(script);
    const b = benchmarkRun(report, parseLabelsJsonl(labels.join("\n")).labels);
    expect(b.calibration.computed).toBe(true);
    expect(b.calibration.bins).toHaveLength(5);
    expect(b.calibration.expectedCalibrationError).toBeGreaterThanOrEqual(0);
  });
});

describe("HTML reports", () => {
  it("escapes dataset content so scripts cannot execute", async () => {
    const payload = `<script>alert('x')</script><img src=x onerror="alert(1)">`;
    const provider = new ScriptedProvider(() => ({ policy: ok }));
    const report = await evaluateDataset([makeCase({ id: "evil", output: payload, metadata: { note: payload } })], [policyRubric], { provider });
    const html = renderRunHtml(report);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("onerror=\"alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Content-Security-Policy");
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
    const cmp = renderComparisonHtml(compareRuns(report, report));
    expect(cmp).toContain("No new failures");
  });
  it("labels simulated runs and unknown cost", async () => {
    const provider = new ScriptedProvider(() => ({ policy: ok }));
    const report = await evaluateDataset([makeCase()], [policyRubric], { provider });
    expect(renderRunHtml(report)).toContain("unknown");
    expect(renderRunHtml({ ...report, simulated: true, provider: { ...report.provider, id: "fixture" } })).toContain("Simulated results");
  });
});

describe("JSONL", () => {
  it("reports invalid lines without dropping valid ones", () => {
    const text = `${JSON.stringify(makeCase({ id: "ok" }))}\n{not json}\n\n{"id":"missing-output","input":"x"}\n`;
    const { cases, issues } = parseCasesJsonl(text);
    expect(cases.map((c) => c.id)).toEqual(["ok"]);
    expect(issues.map((i) => i.line)).toEqual([2, 4]);
  });
});
