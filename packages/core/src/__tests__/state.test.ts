import { describe, expect, it } from "vitest";
import { buildJudgeState } from "../state.js";
import { evaluateCase } from "../evaluate.js";
import { makeCase, policyRubric, ScriptedProvider, answer } from "./helpers.js";

describe("judge state", () => {
  it("never includes expected labels or metadata", async () => {
    const c = makeCase({
      metadata: { secret: "LEAK-METADATA", split: "tuning" },
      expected: { policy: { status: "fail", source: "synthetic", note: "LEAK-EXPECTED" } },
    });
    const { state } = buildJudgeState(c);
    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain("LEAK-METADATA");
    expect(serialised).not.toContain("LEAK-EXPECTED");
    expect(serialised).not.toContain("expected");
    expect(serialised).not.toContain("metadata");

    const provider = new ScriptedProvider(() => ({ policy: answer({ acceptable: 1, unacceptable: 0, insufficient_context: 0 }) }));
    await evaluateCase(c, [policyRubric], { provider });
    const sent = JSON.stringify(provider.requests[0]!.state) + JSON.stringify(provider.requests[0]!.questions);
    expect(sent).not.toContain("LEAK");
    expect(sent).not.toContain("tuning");
  });

  it("records which evidence was included", () => {
    const { state, evidence } = buildJudgeState(
      makeCase({
        context: [{ id: "doc-1", content: "Refund policy text" }],
        toolEvents: [{ id: "t1", name: "lookup", status: "success", output: { ok: true } }],
        messages: [{ id: "m1", role: "user", content: "hi" }],
      }),
    );
    expect(evidence.contextIds).toEqual(["doc-1"]);
    expect(evidence.toolEventIds).toEqual(["t1"]);
    expect(evidence.messageIds).toEqual(["m1"]);
    expect(evidence.policy).toBe(true);
    expect(Object.keys(state as object).sort()).toEqual(["assistant_response", "conversation", "policy", "reference_material", "tool_events", "user_input"]);
  });
});
