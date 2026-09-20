import { createHmac } from "node:crypto";
import {
  MAX_BODY_BYTES,
  RATE_LIMIT_PER_CLIENT,
  RATE_LIMIT_PER_EMAIL,
  RATE_LIMIT_WINDOW_SECONDS,
  SUCCESS_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from "./constants";
import { WaitlistInputSchema, toFieldErrors, type FieldError } from "./schema";
import { StoreUnavailableError, type WaitlistStore } from "./store";

export interface WaitlistHandlerDeps {
  store: WaitlistStore | null;
  /** Exact origin strings (scheme://host[:port]) allowed to POST. */
  allowedOrigins: string[];
  rateLimitSecret: string | undefined;
  now?: () => Date;
  /** Injectable for tests; defaults to console. Never receives request data. */
  logger?: Pick<Console, "warn" | "error">;
}

type SuccessBody = { ok: true; message: string };
type ErrorBody =
  | { ok: false; message: string; errors?: FieldError[] }
  | { ok: false; unavailable: true; message: string };

const FALLBACK_HMAC_KEY = "jeval-waitlist-unconfigured-rate-limit-secret";
let warnedMissingSecret = false;

function json(status: number, body: SuccessBody | ErrorBody, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function success(): Response {
  return json(200, { ok: true, message: SUCCESS_MESSAGE });
}

function unavailable(): Response {
  return json(503, { ok: false, unavailable: true, message: UNAVAILABLE_MESSAGE });
}

function isOriginAllowed(request: Request, allowedOrigins: string[]): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    return allowedOrigins.includes(origin);
  }
  // No Origin header: browsers always send one on cross-site POSTs, so a missing header comes
  // from a same-origin/non-browser context. Only trust it when Fetch Metadata agrees.
  const site = request.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

function clientKeyMaterial(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

function hashKey(secret: string | undefined, scope: "ip" | "email", value: string, logger: Pick<Console, "warn">): string {
  let key = secret?.trim();
  if (!key) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      logger.warn(
        "[waitlist] WAITLIST_RATE_LIMIT_SECRET is not set; rate-limit keys are hashed with a built-in constant. Set the secret in production.",
      );
    }
    key = FALLBACK_HMAC_KEY;
  }
  return createHmac("sha256", key).update(`${scope}:${value}`).digest("hex");
}

/**
 * Framework-agnostic waitlist endpoint. Every response carries `Cache-Control: no-store`;
 * nothing about the request (email, IP, headers) is ever logged.
 */
export async function handleWaitlistRequest(request: Request, deps: WaitlistHandlerDeps): Promise<Response> {
  const logger = deps.logger ?? console;

  if (request.method !== "POST") {
    return json(405, { ok: false, message: "Method not allowed." }, { allow: "POST" });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, message: "Request body too large." });
  }

  if (!isOriginAllowed(request, deps.allowedOrigins)) {
    return json(403, { ok: false, message: "Cross-origin requests are not allowed." });
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return json(400, { ok: false, message: "Could not read the request body." });
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, message: "Request body too large." });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return json(400, { ok: false, message: "The request body must be JSON." });
  }

  const parsed = WaitlistInputSchema.safeParse(payload);
  if (!parsed.success) {
    return json(400, { ok: false, message: "Please check the form and try again.", errors: toFieldErrors(parsed.error) });
  }
  const input = parsed.data;

  // Honeypot: bots fill every field. Answer exactly like a success and store nothing.
  if (input.website !== undefined && input.website.length > 0) {
    return success();
  }

  const store = deps.store;
  if (store === null) {
    return unavailable();
  }

  const ipKey = hashKey(deps.rateLimitSecret, "ip", clientKeyMaterial(request), logger);
  const emailKey = hashKey(deps.rateLimitSecret, "email", input.email, logger);

  try {
    const ipAllowed = await store.consumeRateLimit(ipKey, RATE_LIMIT_PER_CLIENT, RATE_LIMIT_WINDOW_SECONDS);
    const emailAllowed = ipAllowed
      ? await store.consumeRateLimit(emailKey, RATE_LIMIT_PER_EMAIL, RATE_LIMIT_WINDOW_SECONDS)
      : false;
    if (!ipAllowed || !emailAllowed) {
      return json(
        429,
        { ok: false, message: "Too many attempts. Please try again later." },
        { "retry-after": String(RATE_LIMIT_WINDOW_SECONDS) },
      );
    }

    // Both outcomes get the same message so the endpoint does not reveal whether an address is
    // already registered.
    await store.insert({
      email: input.email,
      useCase: input.useCase,
      source: input.source,
      campaign: input.campaign,
      noticeVersion: input.noticeVersion,
    });
    return success();
  } catch (error) {
    const reason = error instanceof StoreUnavailableError ? error.message : "unexpected store failure";
    logger.error(`[waitlist] ${reason}`);
    return unavailable();
  }
}
