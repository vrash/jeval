import { z } from "zod";
import type { JsonValue } from "./json.js";

/** A single-select question. Every semantic check in Jeval is one of these. */
export interface ChoiceQuestionSpec {
  /** Exact instruction the judge answers. Refer to state fields by name. */
  instructions: string;
  /** Option label to description. Labels must be stable identifiers. */
  options: Record<string, string>;
}

export interface JudgeRequest {
  /** The state under judgment. Built by `buildJudgeState`; never contains expected labels. */
  state: JsonValue;
  /** Questions keyed by a stable id (usually `<rubricId>` or `<rubricId>.<part>`). */
  questions: Record<string, ChoiceQuestionSpec>;
  /** Model override for the provider. */
  model?: string;
  /**
   * Harness metadata for providers that need it (the fixture provider keys on caseId).
   * Real providers must not send this to the judge.
   */
  meta?: { caseId?: string };
}

export interface ChoiceAnswer {
  /** The option with the highest probability. */
  choice: string;
  /**
   * Provider-reported confidence statistic. For Jev this summarises the shape of the
   * probability distribution; it is not the probability that the evaluation is correct.
   */
  confidence: number;
  /** Full distribution over the question's options. Values sum to 1. */
  probabilities: Record<string, number>;
}

export interface JudgeUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JudgeResponse {
  /** Model identifier as returned by the provider (e.g. the versioned Jev id). */
  model: string;
  answers: Record<string, ChoiceAnswer>;
  /** Request-level usage covering state, instructions and criteria for all questions. */
  usage: JudgeUsage;
  requestId?: string;
  latencyMs: number;
  /** True when the answers were produced by a simulated provider. */
  simulated: boolean;
  /** Provider-specific notes, e.g. that a fixture fell back to a default. */
  notes?: string[];
}

export interface JudgeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface JudgeProvider {
  /** Stable provider id, e.g. `jev` or `fixture`. */
  readonly id: string;
  /** True for providers that do not call a real model. Always recorded in results. */
  readonly simulated: boolean;
  /** Model the provider will use unless the request overrides it. */
  readonly defaultModel: string;
  judge(request: JudgeRequest, options?: JudgeOptions): Promise<JudgeResponse>;
}

export type ProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "connection"
  | "bad_request"
  | "server"
  | "aborted"
  | "malformed_response"
  | "unknown";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  /** Whether a retry could reasonably succeed. */
  readonly transient: boolean;
  /** Server-suggested delay before retrying, when known. */
  readonly retryAfterMs: number | undefined;
  readonly requestId: string | undefined;
  readonly status: number | undefined;

  constructor(
    message: string,
    options: {
      kind: ProviderErrorKind;
      transient: boolean;
      retryAfterMs?: number | undefined;
      requestId?: string | undefined;
      status?: number | undefined;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderError";
    this.kind = options.kind;
    this.transient = options.transient;
    this.retryAfterMs = options.retryAfterMs;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

const ChoiceAnswerSchema = z.object({
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

/**
 * Validate a provider response against the questions that were asked.
 * Throws a `ProviderError` of kind `malformed_response` on any mismatch so that
 * incomplete or shape-violating answers surface as `error` rather than a decision.
 */
export function validateJudgeResponse(
  questions: Record<string, ChoiceQuestionSpec>,
  response: JudgeResponse,
): JudgeResponse {
  const problems: string[] = [];
  for (const [key, question] of Object.entries(questions)) {
    const raw = response.answers[key];
    if (!raw) {
      problems.push(`missing answer for question '${key}'`);
      continue;
    }
    const parsed = ChoiceAnswerSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(`answer '${key}' has an invalid shape: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    const expectedLabels = Object.keys(question.options).sort();
    const actualLabels = Object.keys(parsed.data.probabilities).sort();
    if (expectedLabels.join("|") !== actualLabels.join("|")) {
      problems.push(
        `answer '${key}' probabilities cover [${actualLabels.join(", ")}] but the question offered [${expectedLabels.join(", ")}]`,
      );
      continue;
    }
    const total = Object.values(parsed.data.probabilities).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) > 0.02) {
      problems.push(`answer '${key}' probabilities sum to ${total.toFixed(3)}, expected 1`);
    }
    if (!(parsed.data.choice in question.options)) {
      problems.push(`answer '${key}' selected unknown option '${parsed.data.choice}'`);
    }
  }
  if (typeof response.model !== "string" || response.model.length === 0) {
    problems.push("response is missing the model identifier");
  }
  if (
    !response.usage ||
    !Number.isFinite(response.usage.inputTokens) ||
    !Number.isFinite(response.usage.outputTokens)
  ) {
    problems.push("response is missing usage totals");
  }
  if (problems.length > 0) {
    throw new ProviderError(`malformed judge response: ${problems.join("; ")}`, {
      kind: "malformed_response",
      transient: false,
      requestId: response.requestId,
    });
  }
  return response;
}
