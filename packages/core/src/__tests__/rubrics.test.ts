import { describe, expect, it } from "vitest";
import { evaluateCase } from "../evaluate.js";
import { parseRubric } from "../schemas.js";
import { answer, bookingRubric, claimRubric, escalationRubric, makeCase, policyRubric, ScriptedProvider } from "./helpers.js";

const claims = answer({ claims_completed: 0.95, does_not_claim: 0.03, unclear: 0.02 });
const noClaim = answer({ claims_completed: 0.05, does_not_claim: 0.9, unclear: 0.05 });
const unclearClaim = answer({ claims_completed: 0.5, does_not_claim: 0.4, unclear: 0.1 });

describe("tool-claim rubric", () => {
  it("passes when the claim is backed by a successful tool event", async () => {
    const provider = new ScriptedProvider(() => ({ "booking.claim": claims }));
    const r = await evaluateCase(
      makeCase({ output: "Booked for 10am.", toolEvents: [{ id: "t1", name: "book_appointment", status: "success" }] }),
      [bookingRubric],
      { provider },
    );
    expect(r.checks[0]!.status).toBe("pass");
    expect(r.checks[0]!.rule).toContain("t1 status=success");
  });
  it("fails when the claim contradicts a failed tool event", async () => {
    const provider = new ScriptedProvider(() => ({ "booking.claim": claims }));
    const r = await evaluateCase(
      makeCase({ output: "Booked for 10am.", toolEvents: [{ id: "t1", name: "book_appointment", status: "failure", error: "slot taken" }] }),
      [bookingRubric],
      { provider },
    );
    expect(r.checks[0]!.status).toBe("fail");
    expect(r.checks[0]!.severity).toBe("critical");
    expect(r.checks[0]!.reason).toContain("slot taken");
  });
  it("reviews when the claim has no matching tool event (missing logs are not proof of failure)", async () => {
    const provider = new ScriptedProvider(() => ({ "booking.claim": claims }));
    const r = await evaluateCase(makeCase({ output: "Booked.", toolEvents: [{ id: "x", name: "lookup", status: "success" }] }), [bookingRubric], { provider });
    expect(r.checks[0]!.status).toBe("review");
    expect(r.checks[0]!.reason).toContain("not proof");
  });
  it("reviews without asking when tool events were not supplied at all", async () => {
    const provider = new ScriptedProvider(() => ({}));
    const r = await evaluateCase(makeCase({ output: "Booked." }), [bookingRubric], { provider });
    expect(r.checks[0]!.status).toBe("review");
    expect(r.checks[0]!.reason).toContain("missing required evidence: toolEvents");
    expect(provider.calls).toBe(0);
  });
  it("skips when the response makes no completion claim", async () => {
    const provider = new ScriptedProvider(() => ({ "booking.claim": noClaim }));
    const r = await evaluateCase(makeCase({ output: "The slot is unavailable, sorry.", toolEvents: [{ id: "t1", name: "book_appointment", status: "failure" }] }), [bookingRubric], { provider });
    expect(r.checks[0]!.status).toBe("skipped");
  });
  it("reviews when the claim is unclear", async () => {
    const provider = new ScriptedProvider(() => ({ "booking.claim": unclearClaim }));
    const r = await evaluateCase(makeCase({ toolEvents: [{ id: "t1", name: "book_appointment", status: "success" }] }), [bookingRubric], { provider });
    expect(r.checks[0]!.status).toBe("review");
  });
  it("applies successWhen exactly to the tool output", async () => {
    const rubric = parseRubric({ ...bookingRubric, params: { ...bookingRubric.params, successWhen: { path: "result.status", equals: "confirmed" } } });
    const provider = new ScriptedProvider(() => ({ "booking.claim": claims }));
    const r = await evaluateCase(
      makeCase({ toolEvents: [{ id: "t1", name: "book_appointment", status: "success", output: { result: { status: "pending" } } }] }),
      [rubric],
      { provider },
    );
    expect(r.checks[0]!.status).toBe("fail");
    expect(r.checks[0]!.rule).toContain("does not match");
  });
});

describe("escalation rubric", () => {
  const required = answer({ required: 0.9, not_required: 0.05, insufficient_context: 0.05 });
  const notRequired = answer({ required: 0.05, not_required: 0.9, insufficient_context: 0.05 });
  const states = answer({ states_escalation: 0.9, does_not_state: 0.05, unclear: 0.05 });
  const doesNot = answer({ states_escalation: 0.05, does_not_state: 0.9, unclear: 0.05 });

  it("passes when required and the escalation tool succeeded", async () => {
    const provider = new ScriptedProvider(() => ({ "escalation.required": required, "escalation.stated": states }));
    const r = await evaluateCase(makeCase({ toolEvents: [{ id: "e1", name: "escalate_to_human", status: "success" }] }), [escalationRubric], { provider });
    expect(r.checks[0]!.status).toBe("pass");
    expect(r.checks[0]!.questionKeys).toEqual(["escalation.required", "escalation.stated"]);
  });
  it("fails when required, no tool event, and the response does not escalate", async () => {
    const provider = new ScriptedProvider(() => ({ "escalation.required": required, "escalation.stated": doesNot }));
    const r = await evaluateCase(makeCase({ toolEvents: [] }), [escalationRubric], { provider });
    expect(r.checks[0]!.status).toBe("fail");
  });
  it("reviews when required and the response claims escalation without a tool event", async () => {
    const provider = new ScriptedProvider(() => ({ "escalation.required": required, "escalation.stated": states }));
    const r = await evaluateCase(makeCase({ toolEvents: [] }), [escalationRubric], { provider });
    expect(r.checks[0]!.status).toBe("review");
  });
  it("skips when the policy does not require escalation", async () => {
    const provider = new ScriptedProvider(() => ({ "escalation.required": notRequired, "escalation.stated": doesNot }));
    const r = await evaluateCase(makeCase({ toolEvents: [] }), [escalationRubric], { provider });
    expect(r.checks[0]!.status).toBe("skipped");
  });
  it("fails when required and the escalation tool failed", async () => {
    const provider = new ScriptedProvider(() => ({ "escalation.required": required, "escalation.stated": states }));
    const r = await evaluateCase(makeCase({ toolEvents: [{ id: "e1", name: "escalate_to_human", status: "failure", error: "queue closed" }] }), [escalationRubric], { provider });
    expect(r.checks[0]!.status).toBe("fail");
  });
});

describe("claim-support rubric", () => {
  it("reviews without asking when no reference material is supplied", async () => {
    const provider = new ScriptedProvider(() => ({}));
    const r = await evaluateCase(makeCase(), [claimRubric], { provider });
    expect(r.checks[0]!.status).toBe("review");
    expect(provider.calls).toBe(0);
  });
  it("distinguishes not-covered (review) from contradicted (fail)", async () => {
    const ctx = [{ id: "kb-1", content: "Returns accepted within 14 days." }];
    const p1 = new ScriptedProvider(() => ({ claim: answer({ supported: 0.1, contradicted: 0.1, not_covered: 0.8 }) }));
    const r1 = await evaluateCase(makeCase({ context: ctx }), [claimRubric], { provider: p1 });
    expect(r1.checks[0]!.status).toBe("review");
    expect(r1.checks[0]!.reason).toContain("insufficient evidence");
    const p2 = new ScriptedProvider(() => ({ claim: answer({ supported: 0.05, contradicted: 0.9, not_covered: 0.05 }) }));
    const r2 = await evaluateCase(makeCase({ context: ctx }), [claimRubric], { provider: p2 });
    expect(r2.checks[0]!.status).toBe("fail");
  });
  it("can be configured to fail on uncovered claims", async () => {
    const rubric = parseRubric({ ...claimRubric, params: { uncoveredIs: "fail" } });
    const p = new ScriptedProvider(() => ({ claim: answer({ supported: 0.1, contradicted: 0.1, not_covered: 0.8 }) }));
    const r = await evaluateCase(makeCase({ context: [{ id: "kb", content: "x" }] }), [rubric], { provider: p });
    expect(r.checks[0]!.status).toBe("fail");
    expect(r.checks[0]!.rule).toBe("params.uncoveredIs=fail");
  });
});

describe("applicability", () => {
  it("skips explicitly inapplicable checks with a reason", async () => {
    const rubric = parseRubric({ ...policyRubric, applicability: { requires: [], onlyWhenMetadata: { channel: "voice" } } });
    const provider = new ScriptedProvider(() => ({}));
    const r = await evaluateCase(makeCase({ metadata: { channel: "chat" } }), [rubric], { provider });
    expect(r.checks[0]!.status).toBe("skipped");
    expect(r.checks[0]!.reason).toContain("metadata.channel");
    expect(provider.calls).toBe(0);
  });
  it("reviews when the policy is missing", async () => {
    const provider = new ScriptedProvider(() => ({}));
    const r = await evaluateCase(makeCase({ policy: undefined }), [policyRubric], { provider });
    expect(r.checks[0]!.status).toBe("review");
    expect(r.checks[0]!.reason).toContain("policy");
  });
  it("rejects rubrics missing kind-specific params", () => {
    expect(() => parseRubric({ id: "x", version: "1", kind: "tool-claim", description: "d", criterion: "c" })).toThrow(/toolName/);
    expect(() => parseRubric({ id: "x", version: "1", kind: "custom", description: "d", criterion: "c" })).toThrow(/outcomes/);
  });
});
