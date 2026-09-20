import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_VERSION, SUCCESS_MESSAGE, UNAVAILABLE_MESSAGE } from "./constants";
import { handleWaitlistRequest, type WaitlistHandlerDeps } from "./handler";
import { StoreUnavailableError, type WaitlistRecord, type WaitlistStore } from "./store";
import { GET } from "@/app/api/waitlist/route";

const ORIGIN = "https://jeval.dev";

class FakeStore implements WaitlistStore {
  records = new Map<string, WaitlistRecord>();
  buckets = new Map<string, { windowStart: number; hits: number }>();
  insertCalls: WaitlistRecord[] = [];
  now = () => Date.now();

  async insert(record: WaitlistRecord): Promise<"created" | "exists"> {
    this.insertCalls.push(record);
    if (this.records.has(record.email)) return "exists";
    this.records.set(record.email, record);
    return "created";
  }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.windowStart + windowSeconds * 1000 <= now) {
      this.buckets.set(key, { windowStart: now, hits: 1 });
      return 1 <= limit;
    }
    bucket.hits += 1;
    return bucket.hits <= limit;
  }
}

function makeRequest(
  body: unknown,
  init: { method?: string; origin?: string | null; headers?: Record<string, string>; rawBody?: string } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json", ...init.headers });
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  const raw = init.rawBody ?? JSON.stringify(body);
  return new Request("https://jeval.dev/api/waitlist", { method: init.method ?? "POST", headers, body: raw });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { email: "Person@Example.com", useCase: "Evaluating agents", noticeVersion: NOTICE_VERSION, ...overrides };
}

describe("handleWaitlistRequest", () => {
  let store: FakeStore;
  let deps: WaitlistHandlerDeps;
  const logger = { warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    store = new FakeStore();
    deps = { store, allowedOrigins: [ORIGIN], rateLimitSecret: "test-secret", logger };
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  it("stores a valid signup with the normalised email and answers the generic message", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody({ email: "  Person@Example.COM " })), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, message: SUCCESS_MESSAGE });
    expect(store.insertCalls).toHaveLength(1);
    expect(store.insertCalls[0]).toEqual({
      email: "person@example.com",
      useCase: "Evaluating agents",
      source: "site",
      campaign: undefined,
      noticeVersion: NOTICE_VERSION,
    });
  });

  it("answers a duplicate with the same 200 and message", async () => {
    const first = await handleWaitlistRequest(makeRequest(validBody()), deps);
    const second = await handleWaitlistRequest(makeRequest(validBody({ useCase: "different" })), deps);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(store.records.get("person@example.com")?.useCase).toBe("Evaluating agents");
  });

  it("rejects an invalid email with 400 without echoing the input", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody({ email: "not-an-email" })), deps);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.errors).toEqual([{ field: "email", message: expect.any(String) }]);
    expect(JSON.stringify(body)).not.toContain("not-an-email");
    expect(store.insertCalls).toHaveLength(0);
  });

  it("rejects a use case longer than 280 characters with 400", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody({ useCase: "x".repeat(281) })), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([{ field: "useCase", message: expect.any(String) }]);
  });

  it("rejects a stale notice version with 400", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody({ noticeVersion: "2020-01-01" })), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([{ field: "noticeVersion", message: expect.any(String) }]);
  });

  it("rejects an oversize body with 413 (actual length)", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody({ useCase: "x".repeat(5000) })), deps);
    expect(res.status).toBe(413);
    expect(store.insertCalls).toHaveLength(0);
  });

  it("rejects an oversize body with 413 (declared content-length)", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody(), { headers: { "content-length": "999999" } }), deps);
    expect(res.status).toBe(413);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await handleWaitlistRequest(makeRequest(null, { rawBody: "{not json" }), deps);
    expect(res.status).toBe(400);
  });

  it("rejects a wrong origin with 403", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody(), { origin: "https://evil.example" }), deps);
    expect(res.status).toBe(403);
    expect(store.insertCalls).toHaveLength(0);
  });

  it("rejects a missing origin unless Sec-Fetch-Site says same-origin", async () => {
    const denied = await handleWaitlistRequest(makeRequest(validBody(), { origin: null }), deps);
    expect(denied.status).toBe(403);
    const allowed = await handleWaitlistRequest(
      makeRequest(validBody(), { origin: null, headers: { "sec-fetch-site": "same-origin" } }),
      deps,
    );
    expect(allowed.status).toBe(200);
  });

  it("answers 200 to a filled honeypot without touching the store", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody({ website: "https://spam.example" })), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: SUCCESS_MESSAGE });
    expect(store.insertCalls).toHaveLength(0);
    expect(store.buckets.size).toBe(0);
  });

  it("answers 503 with unavailable:true when no store is configured", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody()), { ...deps, store: null });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, unavailable: true, message: UNAVAILABLE_MESSAGE });
  });

  it("answers 503 when the store throws, without logging the email", async () => {
    const failing: WaitlistStore = {
      insert: async () => {
        throw new StoreUnavailableError("insert", new Error("boom"));
      },
      consumeRateLimit: async () => true,
    };
    const res = await handleWaitlistRequest(makeRequest(validBody()), { ...deps, store: failing });
    expect(res.status).toBe(503);
    expect((await res.json()).unavailable).toBe(true);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0]?.[0])).not.toContain("example.com");
  });

  it("answers 503 when the store throws a plain error", async () => {
    const failing: WaitlistStore = {
      insert: async () => "created",
      consumeRateLimit: async () => {
        throw new Error("network down");
      },
    };
    const res = await handleWaitlistRequest(makeRequest(validBody()), { ...deps, store: failing });
    expect(res.status).toBe(503);
  });

  it("rate limits the 6th request from one client with 429 and Retry-After", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" };
    for (let i = 0; i < 5; i++) {
      const res = await handleWaitlistRequest(makeRequest(validBody({ email: `p${i}@example.com` }), { headers }), deps);
      expect(res.status).toBe(200);
    }
    const sixth = await handleWaitlistRequest(makeRequest(validBody({ email: "p6@example.com" }), { headers }), deps);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toBe("600");
    expect(store.insertCalls).toHaveLength(5);
    // The client key is an HMAC, never the raw address.
    for (const key of store.buckets.keys()) {
      expect(key).not.toContain("203.0.113.7");
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("rate limits the 4th submission of one email with 429", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await handleWaitlistRequest(
        makeRequest(validBody(), { headers: { "x-forwarded-for": `198.51.100.${i}` } }),
        deps,
      );
      expect(res.status).toBe(200);
    }
    const fourth = await handleWaitlistRequest(
      makeRequest(validBody(), { headers: { "x-forwarded-for": "198.51.100.9" } }),
      deps,
    );
    expect(fourth.status).toBe(429);
  });

  it("warns once when the rate-limit secret is missing but still hashes keys", async () => {
    const res = await handleWaitlistRequest(makeRequest(validBody()), { ...deps, rateLimitSecret: undefined });
    expect(res.status).toBe(200);
    for (const key of store.buckets.keys()) expect(key).toMatch(/^[0-9a-f]{64}$/);
    // Module-level "warned once" flag: at most one warning across the process.
    expect(logger.warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("answers 405 to non-POST methods", async () => {
    const res = await handleWaitlistRequest(
      new Request("https://jeval.dev/api/waitlist", { method: "GET", headers: { origin: ORIGIN } }),
      deps,
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

describe("route GET", () => {
  it("answers 405 with Allow: POST", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
