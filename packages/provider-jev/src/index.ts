import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  UnprocessableEntityError,
  VERSION as TYPESAFE_SDK_VERSION,
  choice,
  type ChoiceQuestion,
  type EntryType,
  type Fetch,
  type LogLevel,
} from "@typesafe-ai/sdk";
import {
  ProviderError,
  type ChoiceAnswer,
  type JudgeOptions,
  type JudgeProvider,
  type JudgeRequest,
  type JudgeResponse,
} from "@jeval/core";

export { TYPESAFE_SDK_VERSION };

/**
 * Integration facts, verified on 2026-09-19 against @typesafe-ai/sdk 0.6.0 type declarations and
 * https://docs.typesafe.ai (sdk/javascript, primitives/choice, confidence, models, api).
 */
export const JEV_INTEGRATION = {
  sdkPackage: "@typesafe-ai/sdk",
  sdkVersionVerified: "0.6.0",
  docsCheckedOn: "2026-09-19",
  docs: [
    "https://docs.typesafe.ai/sdk/javascript",
    "https://docs.typesafe.ai/primitives/choice",
    "https://docs.typesafe.ai/confidence",
    "https://docs.typesafe.ai/models",
    "https://docs.typesafe.ai/api",
  ],
  endpoint: "POST https://api.typesafe.ai/v1/systemone",
  apiKeyEnv: "TYPESAFE_API_KEY",
  /** Model ids listed in the docs on the verification date. `jev-latest` is an alias. */
  knownModels: ["jev-latest", "jev-1.13.0", "jev-preview"],
  /**
   * Vercel AI Gateway proxies TypeSafe's native API (verified 2026-09-19 via
   * https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe): set baseURL to this value, use an
   * AI Gateway API key or VERCEL_OIDC_TOKEN as apiKey, and model "typesafe-ai/jev". Billing then goes
   * through Vercel and the returned model id is the gateway's, not the versioned Jev id.
   */
  vercelGateway: { baseURL: "https://ai-gateway.vercel.sh/typesafe", model: "typesafe-ai/jev" },
  defaultModel: "jev-latest",
  /** Documented limits on the verification date: 64k tokens per request; 32k for state plus the longest question; up to 255 options per choice. */
  limits: { contextTokens: 64_000, stateTokens: 32_000, maxChoiceOptions: 255 },
  /** Documented on the models page on the verification date; verify before relying on it. Output tokens were listed as free. */
  documentedInputPricePerMillionUsd: 0.042,
} as const;

export interface JevProviderOptions {
  /** Defaults to the TYPESAFE_API_KEY environment variable. Never logged. */
  apiKey?: string;
  /** Defaults to TYPESAFE_BASE_URL, then https://api.typesafe.ai. */
  baseURL?: string;
  /** Model id, e.g. jev-latest or jev-1.13.0. Defaults to TYPESAFE_DEFAULT_MODEL, then jev-latest. */
  model?: string;
  /** Per-attempt timeout in ms. Jeval performs retries itself, so the SDK's own retries are disabled. */
  timeoutMs?: number;
  /** Custom fetch, for proxies or tests. */
  fetch?: Fetch;
  /**
   * SDK log level. Default `off`: the SDK's debug level logs request bodies, which contain
   * evaluated conversation content. Raise it deliberately.
   */
  logLevel?: LogLevel;
}

/** Map SDK errors to Jeval provider errors with transient/non-transient classification. */
export function mapJevError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof RateLimitError) {
    return new ProviderError(`Jev rate limit (HTTP 429)`, {
      kind: "rate_limit",
      transient: true,
      retryAfterMs: error.retryAfterMs,
      requestId: error.requestId,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new ProviderError(`Jev authentication failed (HTTP ${error.status}); check TYPESAFE_API_KEY: ${describeBody(error.body)}`, {
      kind: "auth",
      transient: false,
      requestId: error.requestId,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError || error instanceof NotFoundError) {
    return new ProviderError(`Jev rejected the request (HTTP ${error.status}): ${describeBody(error.body)}`, {
      kind: "bad_request",
      transient: false,
      requestId: error.requestId,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof InternalServerError) {
    return new ProviderError(`Jev server error (HTTP ${error.status})`, {
      kind: "server",
      transient: true,
      requestId: error.requestId,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof APIError) {
    const transient = error.status === 408 || error.status === 429 || error.status >= 500;
    return new ProviderError(`Jev HTTP ${error.status}`, {
      kind: transient ? "server" : "bad_request",
      transient,
      requestId: error.requestId,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof APITimeoutError) {
    return new ProviderError(`Jev request timed out after ${error.timeoutMs} ms`, { kind: "timeout", transient: true, cause: error });
  }
  if (error instanceof APIUserAbortError) {
    return new ProviderError("Jev request aborted", { kind: "aborted", transient: false, cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new ProviderError(`Jev connection error: ${error.message}`, { kind: "connection", transient: true, cause: error });
  }
  if (error instanceof TypeSafeError) {
    return new ProviderError(`TypeSafe SDK error: ${error.message}`, { kind: "bad_request", transient: false, cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(`unexpected error from Jev provider: ${message}`, { kind: "unknown", transient: false, cause: error });
}

/** Jev accepts text, JSON objects, arrays or null as state; scalars are rendered as text. */
function toEntryType(state: JudgeRequest["state"]): EntryType {
  if (state === null || typeof state === "string" || typeof state === "object") return state;
  return String(state);
}

function describeBody(body: unknown): string {
  if (body === undefined || body === null) return "no details";
  if (typeof body === "string") return body.slice(0, 300);
  try {
    return JSON.stringify(body).slice(0, 300);
  } catch {
    return "unreadable error body";
  }
}

/**
 * Judge provider backed by TypeSafe's Jev.
 *
 * Every semantic check becomes one `choice` question; all questions for a case are sent in a
 * single `systemOne` request. Real requests send the built judge state to TypeSafe.
 */
export class JevProvider implements JudgeProvider {
  readonly id = "jev";
  readonly simulated = false;
  readonly defaultModel: string;
  private readonly client: TypeSafeClient;

  constructor(options: JevProviderOptions = {}) {
    const config: ConstructorParameters<typeof TypeSafeClient>[0] = {
      retry: { maxRetries: 0 },
      logLevel: options.logLevel ?? "off",
    };
    if (options.apiKey !== undefined) config.apiKey = options.apiKey;
    if (options.baseURL !== undefined) config.baseURL = options.baseURL;
    if (options.model !== undefined) config.defaultModel = options.model;
    if (options.timeoutMs !== undefined) config.timeout = options.timeoutMs;
    if (options.fetch !== undefined) config.fetch = options.fetch;
    try {
      this.client = new TypeSafeClient(config);
    } catch (error) {
      throw mapJevError(error);
    }
    this.defaultModel = this.client.defaultModel;
  }

  async judge(request: JudgeRequest, options: JudgeOptions = {}): Promise<JudgeResponse> {
    const questions: Record<string, ChoiceQuestion> = {};
    for (const [key, q] of Object.entries(request.questions)) {
      const optionCount = Object.keys(q.options).length;
      if (optionCount < 2 || optionCount > JEV_INTEGRATION.limits.maxChoiceOptions) {
        throw new ProviderError(`question '${key}' has ${optionCount} options; Jev choice questions need 2..${JEV_INTEGRATION.limits.maxChoiceOptions}`, {
          kind: "bad_request",
          transient: false,
        });
      }
      questions[key] = choice(q.instructions, q.options);
    }
    // `meta` is harness-only and is deliberately not forwarded.
    const payload: { state: EntryType; questions: Record<string, ChoiceQuestion>; model?: string } = {
      state: toEntryType(request.state),
      questions,
    };
    if (request.model !== undefined) payload.model = request.model;
    const requestOptions: { signal?: AbortSignal; timeout?: number } = {};
    if (options.signal) requestOptions.signal = options.signal;
    if (options.timeoutMs !== undefined) requestOptions.timeout = options.timeoutMs;

    const started = performance.now();
    let data: Awaited<ReturnType<typeof this.client.systemOne>>;
    let requestId: string | undefined;
    try {
      const result = await this.client.systemOne(payload, requestOptions).withResponse();
      data = result.data;
      requestId = result.requestId;
    } catch (error) {
      throw mapJevError(error);
    }
    const latencyMs = Math.round(performance.now() - started);

    const answers: Record<string, ChoiceAnswer> = {};
    const raw = (data as { answers?: Record<string, unknown> }).answers ?? {};
    for (const key of Object.keys(request.questions)) {
      const a = raw[key] as { type?: string; choice?: unknown; confidence?: unknown; probabilities?: unknown } | undefined;
      if (!a) continue; // core reports the missing answer as malformed
      if (a.type !== "choice" || typeof a.choice !== "string" || typeof a.confidence !== "number" || !a.probabilities || typeof a.probabilities !== "object") {
        throw new ProviderError(`Jev answer '${key}' is not a choice answer`, { kind: "malformed_response", transient: false, requestId });
      }
      answers[key] = {
        choice: a.choice,
        confidence: a.confidence,
        probabilities: { ...(a.probabilities as Record<string, number>) },
      };
    }
    const usage = (data as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    const response: JudgeResponse = {
      model: String((data as { model?: unknown }).model ?? ""),
      answers,
      usage: { inputTokens: usage?.input_tokens ?? Number.NaN, outputTokens: usage?.output_tokens ?? Number.NaN },
      latencyMs,
      simulated: false,
    };
    if (requestId !== undefined) response.requestId = requestId;
    return response;
  }
}

export function createJevProvider(options?: JevProviderOptions): JevProvider {
  return new JevProvider(options);
}
