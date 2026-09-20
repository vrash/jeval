import { describe, expect, it } from "vitest";
import { evaluateCase } from "../evaluate.js";
import { parseRubric } from "../schemas.js";
import { extractValues, groundValues } from "../values.js";
import { answer, claimRubric, makeCase, policyRubric, ScriptedProvider } from "./helpers.js";

describe("extractValues", () => {
  it("finds dates, times, money, percentages, durations and numbers with canonical forms", () => {
    const v = extractValues("Booked for Thursday, May 20th at 2pm (confirmation 14:00). Refund of $1,250.50 within 5-7 business days, 12% fee, three years warranty, seat 14A, 2024-05-20.");
    const byKind = Object.fromEntries(v.map((x) => [x.text, x]));
    expect(byKind["May 20th"]?.canonical).toContain("D05-20");
    expect(byKind["2pm"]?.canonical).toEqual(["T14:00"]);
    expect(byKind["14:00"]?.canonical).toEqual(["T14:00"]);
    expect(byKind["$1,250.50"]?.canonical).toContain("M1250.5");
    expect(byKind["12%"]?.canonical).toContain("P12");
    expect(byKind["5-7 business days"]?.canonical).toEqual(expect.arrayContaining(["U5businessday", "U7businessday"]));
    expect(byKind["three years"]?.canonical).toContain("U3year");
    expect(byKind["2024-05-20"]?.canonical).toContain("D2024-05-20");
    expect(v[0]!.id).toBe("v1");
    for (const x of v) expect("Booked for Thursday, May 20th at 2pm (confirmation 14:00). Refund of $1,250.50 within 5-7 business days, 12% fee, three years warranty, seat 14A, 2024-05-20.".slice(x.start, x.end)).toBe(x.text);
  });
  it("ignores list markers and does not double count", () => {
    const v = extractValues("1. First step\n2. Second step costs 30 USD");
    expect(v.map((x) => x.text)).toEqual(["30 USD"]);
  });
});

describe("groundValues", () => {
  it("grounds values across formats", () => {
    const r = groundValues("Your slot is Thursday 2pm on 20 May; the fee is 12 percent.", ["Appointment: 2024-05-20 14:00. Fee: 12%."]);
    expect(r.map((x) => [x.value.text, x.grounded])).toEqual([["2pm", true], ["20 May", true], ["12 percent", true]]);
  });
  it("flags values absent from every source", () => {
    const r = groundValues("The warranty lasts three years and costs $99.", ["Refunds within 30 days."]);
    expect(r.every((x) => !x.grounded)).toBe(true);
  });
});

const grounded = parseRubric({ id: "values", version: "1", kind: "grounded-values", severity: "critical", description: "d", criterion: "numbers must come from sources" });

describe("grounded-values rubric", () => {
  it("passes, fails with named values, and skips without values, all without a judge request", async () => {
    const provider = new ScriptedProvider(() => ({}));
    const ok = await evaluateCase(makeCase({ output: "Booked Tuesday at 10:00, ref B-1021.", toolEvents: [{ id: "t", name: "book", status: "success", output: { time: "10:00", bookingId: "B-1021" } }] }), [grounded], { provider });
    expect(ok.checks[0]!.status).toBe("pass");
    const bad = await evaluateCase(makeCase({ output: "Refund within 5-7 days, and the kettle has a 5 year warranty.", context: [{ id: "kb", content: "Refunds are paid within 5-7 days." }] }), [grounded], { provider });
    expect(bad.checks[0]!.status).toBe("fail");
    expect(bad.checks[0]!.reason).toContain('"5 year"');
    expect(bad.checks[0]!.parts?.map((p) => p.status)).toEqual(["pass", "fail"]);
    const none = await evaluateCase(makeCase({ output: "Certainly, let me check that for you." }), [grounded], { provider });
    expect(none.checks[0]!.status).toBe("skipped");
    expect(provider.calls).toBe(0);
  });
  it("respects groundIn and valueKinds", async () => {
    const r1 = parseRubric({ ...grounded, params: { groundIn: ["context"], valueKinds: ["money"] } });
    const provider = new ScriptedProvider(() => ({}));
    const res = await evaluateCase(makeCase({ input: "Pay $40?", output: "It costs $40 and takes 3 days." }), [r1], { provider });
    expect(res.checks[0]!.parts?.map((p) => p.text)).toEqual(["$40"]);
    expect(res.checks[0]!.status).toBe("fail"); // input is not a source here
  });
});

describe("second reader", () => {
  const twoReaders = parseRubric({ ...policyRubric, params: { readers: 2 } });
  it("asks two phrasings and decides on the average when readers agree", async () => {
    const provider = new ScriptedProvider(() => ({
      policy: answer({ acceptable: 0.7, unacceptable: 0.2, insufficient_context: 0.1 }),
      "policy.r2": answer({ acceptable: 0.9, unacceptable: 0.05, insufficient_context: 0.05 }),
    }));
    const r = await evaluateCase(makeCase(), [twoReaders], { provider });
    expect(Object.keys(provider.requests[0]!.questions)).toEqual(["policy", "policy.r2"]);
    expect(provider.requests[0]!.questions["policy.r2"]!.instructions).toContain("Independent second reading");
    expect(r.checks[0]!.status).toBe("pass"); // 0.7 alone would be review; the average 0.8 passes
    expect(r.checks[0]!.scores?.acceptable).toBeCloseTo(0.8);
    expect(Object.keys(r.checks[0]!.answers!)).toEqual(["policy", "policy.r2"]);
  });
  it("forces review when readers reach opposite decisions", async () => {
    const provider = new ScriptedProvider(() => ({
      policy: answer({ acceptable: 0.9, unacceptable: 0.05, insufficient_context: 0.05 }),
      "policy.r2": answer({ acceptable: 0.1, unacceptable: 0.85, insufficient_context: 0.05 }),
    }));
    const r = await evaluateCase(makeCase(), [twoReaders], { provider });
    expect(r.checks[0]!.status).toBe("review");
    expect(r.checks[0]!.reason).toContain("readers disagree");
    expect(r.checks[0]!.rule).toContain("readers=2");
  });
  it("works per sentence at sentence granularity", async () => {
    const rubric = parseRubric({ ...claimRubric, params: { granularity: "sentence", readers: 2 } });
    const sup = answer({ supported: 0.9, contradicted: 0.05, not_covered: 0.05 });
    const con = answer({ supported: 0.05, contradicted: 0.9, not_covered: 0.05 });
    const provider = new ScriptedProvider(() => ({ "claim.s1": sup, "claim.s1.r2": sup, "claim.s2": sup, "claim.s2.r2": con }));
    const r = await evaluateCase(makeCase({ output: "Refunds take thirty days to arrive. Labels are emailed within one business day.", context: [{ id: "kb", content: "x" }] }), [rubric], { provider });
    expect(r.request?.questionCount).toBe(4);
    expect(r.checks[0]!.parts?.map((p) => p.status)).toEqual(["pass", "review"]);
    expect(r.checks[0]!.status).toBe("review");
    expect(r.checks[0]!.reason).toContain("reader disagreement");
  });
});
