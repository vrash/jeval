import { describe, expect, it } from "vitest";
import { evaluateCase, parseRubric, ProviderError } from "@jeval/core";
import { JevProvider, mapJevError, JEV_INTEGRATION } from "./index.js";

type Call = { url: string; init: RequestInit | undefined; body: Record<string, unknown> };

function mockFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const call = { url, init, body };
    calls.push(call);
    return handler(call);
  };
  return { fetch, calls };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const goodBody = {
  model: "jev-1.13.0",
  answers: {
    policy: { type: "choice", choice: "acceptable", confidence: 0.83, probabilities: { acceptable: 0.9, unacceptable: 0.06, insufficient_context: 0.04 } },
  },
  usage: { input_tokens: 412, output_tokens: 7 },
};

const rubric = parseRubric({ id: "policy", version: "1", kind: "policy-compliance", description: "d", criterion: "Follows the policy?" });
const evalCase = {
  id: "c1",
  input: "Refund?",
  output: "Yes within 30 days.",
  policy: "Refunds within 30 days.",
  expected: { policy: { status: "pass" as const, source: "synthetic" as const } },
  metadata: { split: "SECRET-SPLIT" },
};

describe("JevProvider", () => {
  it("sends one systemOne request with choice questions and maps the response", async () => {
    const { fetch, calls } = mockFetch(() => json(200, goodBody, { "x-typesafe-request-id": "req_abc" }));
    const provider = new JevProvider({ apiKey: "test-key", fetch, model: "jev-1.13.0" });
    const result = await evaluateCase(evalCase, [rubric], { provider });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call.body.model).toBe("jev-1.13.0");
    const q = call.body.questions as Record<string, { type: string; instructions: string; criteria: Record<string, string> }>;
    expect(q.policy!.type).toBe("choice");
    expect(Object.keys(q.policy!.criteria).sort()).toEqual(["acceptable", "insufficient_context", "unacceptable"]);
    const state = call.body.state as Record<string, unknown>;
    expect(state.assistant_response).toBe("Yes within 30 days.");
    expect(JSON.stringify(call.body)).not.toContain("SECRET-SPLIT");
    expect(JSON.stringify(call.body)).not.toContain("expected");
    expect(call.body.meta).toBeUndefined();
    const auth = new Headers(call.init?.headers).get("authorization");
    expect(auth).toBe("Bearer test-key");

    expect(result.request?.model).toBe("jev-1.13.0");
    expect(result.request?.requestId).toBe("req_abc");
    expect(result.request?.usage).toEqual({ inputTokens: 412, outputTokens: 7 });
    expect(result.request?.simulated).toBe(false);
    const check = result.checks[0]!;
    expect(check.status).toBe("pass");
    expect(check.answers?.policy?.confidence).toBe(0.83);
    expect(check.answers?.policy?.probabilities.acceptable).toBe(0.9);
  });

  it("uses jev-latest by default and passes an explicit model override", async () => {
    const { fetch, calls } = mockFetch(() => json(200, goodBody));
    const provider = new JevProvider({ apiKey: "k", fetch });
    expect(provider.defaultModel).toBe(JEV_INTEGRATION.defaultModel);
    await provider.judge({ state: "x", questions: { policy: { instructions: "i", options: { acceptable: "a", unacceptable: "b", insufficient_context: "c" } } } });
    expect(calls[0]!.body.model).toBe("jev-latest");
    await provider.judge({ state: "x", model: "jev-preview", questions: { policy: { instructions: "i", options: { acceptable: "a", unacceptable: "b", insufficient_context: "c" } } } });
    expect(calls[1]!.body.model).toBe("jev-preview");
  });

  it("maps 429 to a transient rate_limit error with Retry-After, without SDK-level retries", async () => {
    const { fetch, calls } = mockFetch(() => json(429, { error: "slow down" }, { "retry-after": "2" }));
    const provider = new JevProvider({ apiKey: "k", fetch });
    const err = await provider.judge({ state: "x", questions: { q: { instructions: "i", options: { a: "1", b: "2" } } } }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("rate_limit");
    expect(err.transient).toBe(true);
    expect(err.retryAfterMs).toBe(2000);
    expect(calls).toHaveLength(1);
  });

  it("maps 401, 422, 529 and timeouts", async () => {
    const q = { q: { instructions: "i", options: { a: "1", b: "2" } } };
    const auth = new JevProvider({ apiKey: "k", fetch: mockFetch(() => json(401, { error: "bad key" })).fetch });
    await expect(auth.judge({ state: "x", questions: q })).rejects.toMatchObject({ kind: "auth", transient: false });
    const bad = new JevProvider({ apiKey: "k", fetch: mockFetch(() => json(422, { detail: "invalid" })).fetch });
    await expect(bad.judge({ state: "x", questions: q })).rejects.toMatchObject({ kind: "bad_request", transient: false });
    const overloaded = new JevProvider({ apiKey: "k", fetch: mockFetch(() => json(529, { error: "overloaded" })).fetch });
    await expect(overloaded.judge({ state: "x", questions: q })).rejects.toMatchObject({ kind: "server", transient: true, status: 529 });
    const slow = new JevProvider({
      apiKey: "k",
      timeoutMs: 20,
      fetch: mockFetch(() => new Promise((resolve) => setTimeout(() => resolve(json(200, goodBody)), 200))).fetch,
    });
    await expect(slow.judge({ state: "x", questions: q })).rejects.toMatchObject({ kind: "timeout", transient: true });
  });

  it("surfaces non-choice answers as malformed", async () => {
    const { fetch } = mockFetch(() => json(200, { ...goodBody, answers: { policy: { type: "noul", noul: 0.4 } } }));
    const provider = new JevProvider({ apiKey: "k", fetch });
    const result = await evaluateCase(evalCase, [rubric], { provider, maxAttempts: 1 });
    expect(result.checks[0]!.status).toBe("error");
    expect(result.error?.kind).toBe("malformed_response");
  });

  it("reports a missing answer as malformed via core validation", async () => {
    const { fetch } = mockFetch(() => json(200, { ...goodBody, answers: {} }));
    const provider = new JevProvider({ apiKey: "k", fetch });
    const result = await evaluateCase(evalCase, [rubric], { provider, maxAttempts: 1 });
    expect(result.error?.message).toContain("missing answer");
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    const { fetch } = mockFetch(() => new Promise((resolve) => setTimeout(() => resolve(json(200, goodBody)), 500)));
    const provider = new JevProvider({ apiKey: "k", fetch });
    const p = provider.judge({ state: "x", questions: { q: { instructions: "i", options: { a: "1", b: "2" } } } }, { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
  });

  it("fails fast without an API key", () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect(() => new JevProvider({ fetch: mockFetch(() => json(200, goodBody)).fetch })).toThrow(ProviderError);
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });

  it("maps unknown errors without losing the message", () => {
    const e = mapJevError(new Error("weird"));
    expect(e.kind).toBe("unknown");
    expect(e.message).toContain("weird");
  });
});
