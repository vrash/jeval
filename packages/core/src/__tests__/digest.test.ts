import { describe, expect, it } from "vitest";
import { cutSafe, DIGEST_MARKER_ID } from "../digest.js";
import { estimateRun } from "../estimate.js";
import { evaluateCase } from "../evaluate.js";
import { buildJudgeState } from "../state.js";
import { answer, makeCase, policyRubric, ScriptedProvider, bookingRubric } from "./helpers.js";

function longMessages(n: number, size = 400) {
  return Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant", content: `turn ${i + 1} ` + "x".repeat(size) }));
}

describe("digest", () => {
  it("does nothing when the state fits", () => {
    const { state, evidence } = buildJudgeState(makeCase({ messages: longMessages(4) }), { digest: { maxChars: 100_000 } });
    expect(evidence.digest).toBeUndefined();
    expect((state as { conversation: unknown[] }).conversation).toHaveLength(4);
  });

  it("keeps head and tail turns, inserts one marker, and records the omitted ids", () => {
    const messages = longMessages(40);
    const { state, evidence } = buildJudgeState(makeCase({ messages }), { digest: { maxChars: 6000, headShare: 0.25 } });
    const conv = (state as { conversation: Array<{ id: string; content: string }> }).conversation;
    expect(evidence.digest?.applied).toBe(true);
    expect(evidence.digest!.omittedMessageIds.length).toBeGreaterThan(20);
    const marker = conv.find((m) => m.id === DIGEST_MARKER_ID)!;
    expect(marker.content).toContain("omitted");
    expect(conv[0]!.id).toBe("m1");
    expect(conv[conv.length - 1]!.id).toBe("m40");
    // tail gets more budget than head
    const markerIndex = conv.findIndex((m) => m.id === DIGEST_MARKER_ID);
    expect(conv.length - markerIndex - 1).toBeGreaterThan(markerIndex);
    // evidence.messageIds excludes omitted ids
    for (const id of evidence.digest!.omittedMessageIds) expect(evidence.messageIds).not.toContain(id);
    expect(JSON.stringify(state).length).toBeLessThanOrEqual(6000 + 400);
  });

  it("truncates oversized text fields with a visible marker and safe boundaries", () => {
    const big = "y".repeat(50_000) + "😀";
    const { state, evidence } = buildJudgeState(makeCase({ context: [{ id: "kb", content: big }], output: "z".repeat(30_000) }), { digest: { maxChars: 20_000 } });
    expect(evidence.digest?.applied).toBe(true);
    expect(evidence.digest!.truncated.length).toBeGreaterThan(0);
    const s = JSON.stringify(state);
    expect(s).toContain("truncated by jeval digest");
    expect(s.length).toBeLessThanOrEqual(20_000 + 500);
    expect(cutSafe("ab😀", 3)).toBe("ab");
  });

  it("can be disabled", () => {
    const { evidence } = buildJudgeState(makeCase({ messages: longMessages(40) }), { digest: false });
    expect(evidence.digest).toBeUndefined();
  });

  it("is recorded on check results and the marker reaches the provider", async () => {
    const provider = new ScriptedProvider(() => ({ policy: answer({ acceptable: 0.9, unacceptable: 0.05, insufficient_context: 0.05 }) }));
    const r = await evaluateCase(makeCase({ messages: longMessages(40) }), [policyRubric], { provider, digest: { maxChars: 6000 } });
    expect(r.checks[0]!.evidence.digest?.applied).toBe(true);
    expect(JSON.stringify(provider.requests[0]!.state)).toContain("jeval digest");
  });
});

describe("estimateRun", () => {
  it("sizes only the requests that would be sent and reports unknown cost without pricing", () => {
    const cases = [makeCase({ id: "a", toolEvents: [] }), makeCase({ id: "b", policy: undefined, toolEvents: [] })];
    const est = estimateRun(cases, [policyRubric, bookingRubric]);
    expect(est.caseCount).toBe(2);
    expect(est.requests).toBe(2); // b still asks the booking question
    expect(est.cases[0]!.questions).toBe(2);
    expect(est.cases[1]!.questions).toBe(1);
    expect(est.estimatedInputTokens).toBeGreaterThan(0);
    expect(est.cost).toBeNull();
    const none = estimateRun([makeCase({ policy: undefined })], [policyRubric]);
    expect(none.requests).toBe(0);
    expect(none.casesWithoutRequest).toBe(1);
    expect(none.estimatedInputTokens).toBe(0);
  });
  it("estimates cost from configured pricing and labels it", () => {
    const est = estimateRun([makeCase()], [policyRubric], { pricing: { inputPerMillionTokensUsd: 1, asOf: "2026-09-19", source: "t" } });
    expect(est.cost?.estimated).toBe(true);
    expect(est.cost?.amount).toBeCloseTo(est.estimatedInputTokens / 1_000_000);
    expect(est.method).toContain("characters");
  });
});
