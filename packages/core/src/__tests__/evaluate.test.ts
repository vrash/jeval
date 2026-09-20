import { describe, expect, it } from "vitest";
import { evaluateCase, evaluateDataset } from "../evaluate.js";
import { ProviderError } from "../provider.js";
import { FixtureProvider } from "../fixture.js";
import { answer, bookingRubric, customRubric, escalationRubric, makeCase, policyRubric, ScriptedProvider } from "./helpers.js";

const ok = answer({ acceptable: 0.9, unacceptable: 0.05, insufficient_context: 0.05 });
const allAnswers = {
  policy: ok,
  tone: ok,
  "booking.claim": answer({ claims_completed: 0.9, does_not_claim: 0.05, unclear: 0.05 }),
  "escalation.required": answer({ required: 0.05, not_required: 0.9, insufficient_context: 0.05 }),
  "escalation.stated": answer({ states_escalation: 0.1, does_not_state: 0.8, unclear: 0.1 }),
};
const rubrics = [policyRubric, customRubric, bookingRubric, escalationRubric];
const fullCase = makeCase({ toolEvents: [{ id: "t1", name: "book_appointment", status: "success" }] });

describe("evaluateCase batching", () => {
  it("sends all semantic questions in one request and records usage once per case", async () => {
    const provider = new ScriptedProvider(() => allAnswers, { usage: { inputTokens: 1234, outputTokens: 5 } });
    const r = await evaluateCase(fullCase, rubrics, { provider });
    expect(provider.calls).toBe(1);
    expect(Object.keys(provider.requests[0]!.questions).sort()).toEqual(["booking.claim", "escalation.required", "escalation.stated", "policy", "tone"]);
    expect(r.request?.usage.inputTokens).toBe(1234);
    expect(r.request?.questionCount).toBe(5);
    expect(r.checks).toHaveLength(4);
    expect(r.request?.model).toBe("scripted-model-1");
    expect(r.request?.requestId).toBe("req-1");
  });

  it("marks malformed responses as errors, not decisions", async () => {
    const provider = new ScriptedProvider(() => ({ policy: answer({ acceptable: 0.6, unacceptable: 0.6, insufficient_context: 0 }) }));
    const r = await evaluateCase(makeCase(), [policyRubric], { provider, maxAttempts: 1 });
    expect(r.checks[0]!.status).toBe("error");
    expect(r.error?.kind).toBe("malformed_response");
    expect(r.error?.message).toMatch(/sum to/);
  });

  it("errors when an answer is missing or has the wrong options", async () => {
    const missing = new ScriptedProvider(() => ({ tone: ok }));
    const r1 = await evaluateCase(makeCase(), [policyRubric], { provider: missing, maxAttempts: 1 });
    expect(r1.error?.message).toContain("missing answer for question 'policy'");
    const wrong = new ScriptedProvider(() => ({ policy: answer({ yes: 1, no: 0 }) }));
    const r2 = await evaluateCase(makeCase(), [policyRubric], { provider: wrong, maxAttempts: 1 });
    expect(r2.error?.message).toContain("probabilities cover");
  });

  it("retries transient errors with bounded attempts and honours retryAfter", async () => {
    const waits: number[] = [];
    const provider = new ScriptedProvider((_req, call) =>
      call < 3 ? new ProviderError("429", { kind: "rate_limit", transient: true, retryAfterMs: 1500 }) : { policy: ok },
    );
    const r = await evaluateCase(makeCase(), [policyRubric], {
      provider,
      maxAttempts: 3,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(provider.calls).toBe(3);
    expect(r.request?.attempts).toBe(3);
    expect(r.checks[0]!.status).toBe("pass");
    expect(waits.every((w) => w >= 1500 * 0.75)).toBe(true);
  });

  it("does not retry non-transient errors", async () => {
    const provider = new ScriptedProvider(() => new ProviderError("401", { kind: "auth", transient: false }));
    const r = await evaluateCase(makeCase(), [policyRubric], { provider, maxAttempts: 3, sleep: async () => {} });
    expect(provider.calls).toBe(1);
    expect(r.checks[0]!.status).toBe("error");
    expect(r.error?.kind).toBe("auth");
  });

  it("gives up after maxAttempts on persistent transient errors", async () => {
    const provider = new ScriptedProvider(() => new ProviderError("503", { kind: "server", transient: true }));
    const r = await evaluateCase(makeCase(), [policyRubric], { provider, maxAttempts: 2, sleep: async () => {} });
    expect(provider.calls).toBe(2);
    expect(r.error?.attempts).toBe(2);
  });

  it("makes no request when every check is decided deterministically", async () => {
    const provider = new ScriptedProvider(() => ({}));
    const r = await evaluateCase(makeCase({ policy: undefined }), [policyRubric], { provider });
    expect(provider.calls).toBe(0);
    expect(r.request).toBeUndefined();
    expect(r.checks[0]!.status).toBe("review");
  });
});

describe("evaluateDataset", () => {
  it("continues after per-case failures and summarises accurately", async () => {
    const provider = new ScriptedProvider((req) =>
      req.meta?.caseId === "c2" ? new ProviderError("boom", { kind: "server", transient: false }) : { policy: ok, tone: ok },
    );
    const cases = [makeCase({ id: "c1" }), makeCase({ id: "c2" }), makeCase({ id: "c3", policy: undefined })];
    const report = await evaluateDataset(cases, [policyRubric, customRubric], { provider, concurrency: 2 });
    expect(report.summary.caseCount).toBe(3);
    expect(report.summary.caseErrors).toBe(1);
    expect(report.summary.counts).toEqual({ pass: 3, fail: 0, review: 1, skipped: 0, error: 2 });
    expect(report.summary.usage.requests).toBe(2);
    expect(report.summary.usage.inputTokens).toBe(200);
    expect(report.summary.decidedCoverage).toBeCloseTo(3 / 6);
    expect(report.summary.passRateDecided).toBe(1);
    expect(report.summary.passRateApplicable).toBeCloseTo(0.5);
    expect(report.mode).toBe("live");
    expect(report.simulated).toBe(false);
    expect(report.cost).toBeNull();
  });

  it("handles an empty dataset without dividing by zero", async () => {
    const provider = new ScriptedProvider(() => ({}));
    const report = await evaluateDataset([], [policyRubric], { provider });
    expect(report.summary.caseCount).toBe(0);
    expect(report.summary.passRateDecided).toBeNull();
    expect(report.summary.decidedCoverage).toBeNull();
    expect(report.summary.latencyMs.mean).toBeNull();
  });

  it("rejects duplicate case ids", async () => {
    const provider = new ScriptedProvider(() => ({}));
    await expect(evaluateDataset([makeCase({ id: "a" }), makeCase({ id: "a" })], [policyRubric], { provider })).rejects.toThrow(/duplicate case id/);
  });

  it("respects the concurrency bound", async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = new ScriptedProvider(() => ({ policy: ok }));
    const original = provider.judge.bind(provider);
    provider.judge = async (req, opts) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await original(req, opts);
      } finally {
        inFlight -= 1;
      }
    };
    const cases = Array.from({ length: 10 }, (_, i) => makeCase({ id: `c${i}` }));
    await evaluateDataset(cases, [policyRubric], { provider, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("stops scheduling cases after cancellation", async () => {
    const controller = new AbortController();
    const provider = new ScriptedProvider(() => ({ policy: ok }));
    const original = provider.judge.bind(provider);
    provider.judge = async (req, opts) => {
      const r = await original(req, opts);
      controller.abort();
      return r;
    };
    const cases = Array.from({ length: 6 }, (_, i) => makeCase({ id: `c${i}` }));
    const report = await evaluateDataset(cases, [policyRubric], { provider, concurrency: 1, signal: controller.signal });
    expect(report.cases[0]!.checks[0]!.status).toBe("pass");
    expect(report.cases.slice(1).every((c) => c.error?.kind === "aborted")).toBe(true);
    expect(provider.calls).toBe(1);
  });

  it("estimates cost only when pricing is configured and the run is not simulated", async () => {
    const provider = new ScriptedProvider(() => ({ policy: ok }), { usage: { inputTokens: 500_000, outputTokens: 1 } });
    const report = await evaluateDataset([makeCase()], [policyRubric], {
      provider,
      pricing: { inputPerMillionTokensUsd: 0.042, asOf: "2026-09-19", source: "test" },
    });
    expect(report.cost?.estimated).toBe(true);
    expect(report.cost?.amount).toBeCloseTo(0.021);
    const simulated = await evaluateDataset([makeCase()], [policyRubric], {
      provider: new FixtureProvider({ fixtures: { model: "fixture-simulated", cases: { "case-1": { policy: { probabilities: { acceptable: 1 } } } } } }),
      pricing: { inputPerMillionTokensUsd: 0.042, asOf: "2026-09-19", source: "test" },
    });
    expect(simulated.cost).toBeNull();
    expect(simulated.simulated).toBe(true);
    expect(simulated.mode).toBe("fixture");
    expect(simulated.cases[0]!.request?.simulated).toBe(true);
  });
});

describe("FixtureProvider", () => {
  it("is deterministic and labelled simulated, and notes fallbacks", async () => {
    const provider = new FixtureProvider();
    const r1 = await evaluateCase(makeCase(), [policyRubric], { provider });
    const r2 = await evaluateCase(makeCase(), [policyRubric], { provider });
    expect(r1.checks[0]!.answers).toEqual(r2.checks[0]!.answers);
    expect(r1.request?.simulated).toBe(true);
    expect(r1.request?.notes?.[0]).toContain("fallback fixture");
    expect(r1.request?.latencyMs).toBe(0);
  });
  it("throws in strict mode when a fixture is missing", async () => {
    const provider = new FixtureProvider({ strict: true, fixtures: { model: "m", cases: {} } });
    const r = await evaluateCase(makeCase(), [policyRubric], { provider, maxAttempts: 1 });
    expect(r.checks[0]!.status).toBe("error");
  });
});
