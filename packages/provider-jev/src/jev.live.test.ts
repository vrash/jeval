/**
 * Opt-in live smoke test. Runs only when JEVAL_LIVE=1 and TYPESAFE_API_KEY are set:
 *   pnpm --filter @jeval/provider-jev test:live
 * Budget: one systemOne request with a tiny state and two questions.
 */
import { describe, expect, it } from "vitest";
import { evaluateCase, parseRubric } from "@jeval/core";
import { JevProvider } from "./index.js";

const enabled = process.env.JEVAL_LIVE === "1" && !!process.env.TYPESAFE_API_KEY;

describe.skipIf(!enabled)("live Jev smoke test", () => {
  it("answers a small batched request", async () => {
    const provider = new JevProvider({ timeoutMs: 30_000 });
    const rubrics = [
      parseRubric({ id: "policy", version: "1", kind: "policy-compliance", description: "d", criterion: "Does the response follow the policy?" }),
      parseRubric({
        id: "tone",
        version: "1",
        kind: "custom",
        description: "d",
        criterion: "Is the response polite?",
        outcomes: { acceptable: "Polite.", unacceptable: "Rude or dismissive.", insufficient: "Cannot tell." },
      }),
    ];
    const result = await evaluateCase(
      { id: "smoke", input: "Can I return this jacket?", output: "Yes, returns are accepted within 30 days with a receipt.", policy: "Returns are accepted within 30 days with a receipt." },
      rubrics,
      { provider, maxAttempts: 1 },
    );
    console.log("LIVE SMOKE RESULT", JSON.stringify({ model: result.request?.model, usage: result.request?.usage, latencyMs: result.request?.latencyMs, statuses: result.checks.map((c) => [c.rubricId, c.status]) }));
    expect(result.error).toBeUndefined();
    expect(result.request?.model).toMatch(/^(jev|typesafe-ai\/jev)/); // direct API returns a versioned jev-* id; Vercel AI Gateway reports typesafe-ai/jev
    expect(result.request?.usage.inputTokens).toBeGreaterThan(0);
    expect(result.checks).toHaveLength(2);
  });
});

if (!enabled) {
  console.log("live Jev smoke test skipped: set JEVAL_LIVE=1 and TYPESAFE_API_KEY to run it");
}
