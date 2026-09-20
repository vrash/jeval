import { describe, expect, it } from "vitest";
import { automationCurve, benchmarkRun } from "../benchmark.js";
import { evaluateCase, evaluateDataset } from "../evaluate.js";
import { parseRubric, type EvalCase } from "../schemas.js";
import { splitSentences } from "../sentences.js";
import { answer, claimRubric, makeCase, ScriptedProvider } from "./helpers.js";

describe("splitSentences", () => {
  it("splits on sentence punctuation and newlines with stable offsets", () => {
    const text = "Refunds take 5-7 days. Dr. Smith approved it! Is that ok?\n- Yes, within 30 days.";
    const s = splitSentences(text, { minChars: 5 });
    expect(s.map((x) => x.text)).toEqual(["Refunds take 5-7 days.", "Dr. Smith approved it!", "Is that ok?", "Yes, within 30 days."]);
    for (const x of s) expect(text.slice(x.start, x.end)).toBe(x.text);
    expect(s[0]!.id).toBe("s1");
  });
  it("merges short fragments and caps the count", () => {
    const s = splitSentences("Ok. Fine. This is a proper sentence that stands alone. Another proper sentence follows here.", { minChars: 20 });
    expect(s.length).toBe(2);
    const many = splitSentences(Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here and long enough.`).join(" "), { maxSentences: 10 });
    expect(many.length).toBe(10);
    expect(many[9]!.end).toBeGreaterThan(many[8]!.end);
  });
  it("returns nothing for empty text", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});

const sentenceRubric = parseRubric({ ...claimRubric, params: { granularity: "sentence", uncoveredIs: "fail" } });
const ctx = [{ id: "kb", content: "Refunds are paid within 30 days. Labels are emailed within one business day." }];
const supported = answer({ supported: 0.92, contradicted: 0.04, not_covered: 0.04 });
const contradicted = answer({ supported: 0.05, contradicted: 0.9, not_covered: 0.05 });
const uncovered = answer({ supported: 0.1, contradicted: 0.1, not_covered: 0.8 });
const unsure = answer({ supported: 0.5, contradicted: 0.3, not_covered: 0.2 });

describe("sentence-level claim support", () => {
  const c: EvalCase = makeCase({ output: "Refunds are paid within 30 days. Labels arrive in one business day. The kettle has a five-year warranty.", context: ctx });
  it("asks one question per sentence in a single request and fails on any unsupported sentence", async () => {
    const provider = new ScriptedProvider(() => ({ "claim.s1": supported, "claim.s2": supported, "claim.s3": uncovered }));
    const r = await evaluateCase(c, [sentenceRubric], { provider });
    expect(provider.calls).toBe(1);
    expect(Object.keys(provider.requests[0]!.questions)).toEqual(["claim.s1", "claim.s2", "claim.s3"]);
    expect(provider.requests[0]!.questions["claim.s3"]!.instructions).toContain("five-year warranty");
    const ch = r.checks[0]!;
    expect(ch.status).toBe("fail");
    expect(ch.parts?.map((p) => p.status)).toEqual(["pass", "pass", "fail"]);
    expect(ch.parts?.[2]?.text).toBe("The kettle has a five-year warranty.");
    expect(ch.reason).toContain("1 of 3 sentence(s) unsupported (s3)");
    expect(ch.scores).toEqual({ acceptable: 0.1, unacceptable: 0.9 });
    expect(r.request?.questionCount).toBe(3);
  });
  it("reviews when a sentence is undecided and nothing failed, passes when all are supported", async () => {
    const p1 = new ScriptedProvider(() => ({ "claim.s1": supported, "claim.s2": unsure, "claim.s3": supported }));
    expect((await evaluateCase(c, [sentenceRubric], { provider: p1 })).checks[0]!.status).toBe("review");
    const p2 = new ScriptedProvider(() => ({ "claim.s1": supported, "claim.s2": supported, "claim.s3": supported }));
    const r = await evaluateCase(c, [sentenceRubric], { provider: p2 });
    expect(r.checks[0]!.status).toBe("pass");
    expect(r.checks[0]!.reason).toContain("all 3 sentence(s) supported");
  });
  it("contradiction fails regardless of uncoveredIs", async () => {
    const rubric = parseRubric({ ...claimRubric, params: { granularity: "sentence" } });
    const p = new ScriptedProvider(() => ({ "claim.s1": supported, "claim.s2": contradicted, "claim.s3": uncovered }));
    const r = await evaluateCase(c, [rubric], { provider: p });
    expect(r.checks[0]!.parts?.map((x) => x.status)).toEqual(["pass", "fail", "review"]);
    expect(r.checks[0]!.status).toBe("fail");
  });
  it("benchmark aligns part-level labels as rubricId#partId", async () => {
    const provider = new ScriptedProvider(() => ({ "claim.s1": supported, "claim.s2": supported, "claim.s3": uncovered }));
    const report = await evaluateDataset([c], [sentenceRubric], { provider });
    const labels = [
      { caseId: c.id, rubricId: "claim", expected: "fail" as const, source: "human" as const },
      { caseId: c.id, rubricId: "claim#s1", expected: "pass" as const, source: "human" as const },
      { caseId: c.id, rubricId: "claim#s2", expected: "pass" as const, source: "human" as const },
      { caseId: c.id, rubricId: "claim#s3", expected: "fail" as const, source: "human" as const },
    ];
    const b = benchmarkRun(report, labels);
    expect(b.sampleCount).toBe(4);
    expect(b.failureDetection.confusion).toEqual({ truePositive: 2, falsePositive: 0, falseNegative: 0, trueNegative: 2 });
    expect(b.automation.sample).toBe(4);
  });
});

describe("automationCurve", () => {
  it("trades coverage for accuracy and suggests a threshold", () => {
    const samples = [
      { acceptable: 0.95, unacceptable: 0.05, fail: false },
      { acceptable: 0.9, unacceptable: 0.1, fail: false },
      { acceptable: 0.1, unacceptable: 0.9, fail: true },
      { acceptable: 0.6, unacceptable: 0.4, fail: true }, // wrong at low thresholds, excluded at high ones
      { acceptable: 0.55, unacceptable: 0.45, fail: false },
    ];
    const curve = automationCurve(samples, { targetAccuracy: 0.99, minDecided: 3 });
    const at = (t: number) => curve.points.find((p) => p.threshold === t)!;
    expect(at(0.5).decided).toBe(5);
    expect(at(0.5).accuracy).toBeCloseTo(0.8);
    expect(at(0.7).decided).toBe(3);
    expect(at(0.7).accuracy).toBe(1);
    expect(at(0.7).failRecall).toBeCloseTo(0.5);
    expect(curve.suggestion).toMatchObject({ threshold: 0.65, accuracy: 1 });
    const none = automationCurve(samples, { targetAccuracy: 1, minDecided: 5 });
    expect(none.suggestion).toMatchObject({ threshold: null });
  });
  it("is reported by benchmarkRun from check scores", async () => {
    const provider = new ScriptedProvider((req) => ({ policy: req.meta?.caseId === "a" ? answer({ acceptable: 0.9, unacceptable: 0.05, insufficient_context: 0.05 }) : answer({ acceptable: 0.05, unacceptable: 0.9, insufficient_context: 0.05 }) }));
    const { policyRubric } = await import("./helpers.js");
    const report = await evaluateDataset([makeCase({ id: "a" }), makeCase({ id: "b" })], [policyRubric], { provider });
    const b = benchmarkRun(report, [
      { caseId: "a", rubricId: "policy", expected: "pass", source: "synthetic" },
      { caseId: "b", rubricId: "policy", expected: "fail", source: "synthetic" },
    ], { targetAccuracy: 0.9, minDecidedForSuggestion: 1 });
    expect(b.automation.sample).toBe(2);
    expect(b.automation.points[0]!.accuracy).toBe(1);
    expect(b.automation.suggestion).toMatchObject({ threshold: 0.5 });
  });
});
