import { fingerprint, stableStringify } from "./json.js";
import type { ChoiceQuestionSpec, JudgeProvider, JudgeRequest } from "./provider.js";
import { ProviderError, validateJudgeResponse } from "./provider.js";
import { planCheck, rubricFingerprint, type CheckPlan } from "./rubrics.js";
import type { CaseResult, CheckResult, CostEstimate, RunReport } from "./results.js";
import type { EvalCase, Rubric, Thresholds } from "./schemas.js";
import { DEFAULT_THRESHOLDS, EvalCaseSchema, ThresholdsSchema, validateRubric } from "./schemas.js";
import { buildJudgeState } from "./state.js";
import type { DigestOptions } from "./digest.js";
import { withRetries } from "./retry.js";
import { summarize } from "./summary.js";

export interface PricingConfig {
  /** Price per million input tokens, in USD, as configured by the operator. */
  inputPerMillionTokensUsd: number;
  /** ISO date the rate was recorded. */
  asOf: string;
  /** Where the rate came from, e.g. a docs URL. */
  source: string;
}

export interface EvaluateOptions {
  provider: JudgeProvider;
  /** Run-level thresholds; rubric-level thresholds override. */
  thresholds?: Thresholds;
  /** Model override forwarded to the provider. */
  model?: string;
  timeoutMs?: number;
  /** Total attempts per case request, including the first. */
  maxAttempts?: number;
  signal?: AbortSignal;
  /** Digest settings for long states; `false` disables. Default 110k characters. */
  digest?: DigestOptions | false;
  /** Test/instrumentation hook for retry waits. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (info: { caseId: string; attempt: number; delayMs: number; error: unknown }) => void;
}

export interface DatasetOptions extends EvaluateOptions {
  concurrency?: number;
  datasetPath?: string;
  provenance?: string;
  pricing?: PricingConfig;
  labels?: Record<string, string>;
  onCaseComplete?: (result: CaseResult, index: number, total: number) => void;
}

function errorInfo(error: unknown): { kind: string; message: string } {
  if (error instanceof ProviderError) return { kind: error.kind, message: error.message };
  if (error instanceof Error) return { kind: error.name || "error", message: error.message };
  return { kind: "unknown", message: String(error) };
}

/**
 * Evaluate one case against a set of rubrics.
 *
 * All semantic questions for the case are sent in one provider request, so request-level
 * usage and latency are recorded once on the case, not once per check.
 */
export async function evaluateCase(evalCase: EvalCase, rubrics: readonly Rubric[], options: EvaluateOptions): Promise<CaseResult> {
  const startedAt = new Date().toISOString();
  const parsed = EvalCaseSchema.parse(evalCase);
  for (const r of rubrics) validateRubric(r);
  const thresholds = ThresholdsSchema.parse(options.thresholds ?? DEFAULT_THRESHOLDS);

  const { state, evidence } = buildJudgeState(parsed, options.digest === undefined ? {} : { digest: options.digest });
  const plans: Array<{ rubric: Rubric; plan: CheckPlan }> = rubrics.map((rubric) => ({
    rubric,
    plan: planCheck(rubric, parsed, evidence, thresholds),
  }));

  const questions: Record<string, ChoiceQuestionSpec> = {};
  for (const { plan } of plans) {
    if (plan.kind === "pending") Object.assign(questions, plan.questions);
  }

  const checks: CheckResult[] = [];
  const decided = (r: Omit<CheckResult, "caseId">): CheckResult => ({ caseId: parsed.id, ...r });

  let request: CaseResult["request"];
  let caseError: CaseResult["error"];

  if (Object.keys(questions).length > 0) {
    const judgeRequest: JudgeRequest = { state, questions, meta: { caseId: parsed.id } };
    if (options.model !== undefined) judgeRequest.model = options.model;
    const maxAttempts = options.maxAttempts ?? 3;
    const retryOpts: Parameters<typeof withRetries>[1] = {
      maxAttempts,
      signal: options.signal,
      onRetry: (info) => options.onRetry?.({ caseId: parsed.id, ...info }),
    };
    if (options.sleep) retryOpts.sleep = options.sleep;
    try {
      const { value: response, attempts } = await withRetries(async () => {
        const judgeOpts: { signal?: AbortSignal; timeoutMs?: number } = {};
        if (options.signal) judgeOpts.signal = options.signal;
        if (options.timeoutMs !== undefined) judgeOpts.timeoutMs = options.timeoutMs;
        const raw = await options.provider.judge(judgeRequest, judgeOpts);
        return validateJudgeResponse(questions, raw);
      }, retryOpts);
      request = {
        provider: options.provider.id,
        model: response.model,
        simulated: response.simulated || options.provider.simulated,
        latencyMs: response.latencyMs,
        usage: { ...response.usage },
        attempts,
        questionCount: Object.keys(questions).length,
        questions,
      };
      if (response.requestId !== undefined) request.requestId = response.requestId;
      if (response.notes && response.notes.length > 0) request.notes = [...response.notes];
      for (const { plan } of plans) {
        if (plan.kind === "decided") checks.push(decided(plan.result));
        else checks.push(decided(plan.decide(response.answers)));
      }
    } catch (error) {
      const info = errorInfo(error);
      const attempts = error instanceof ProviderError && error.transient ? maxAttempts : 1;
      caseError = { ...info, attempts };
      for (const { rubric, plan } of plans) {
        if (plan.kind === "decided") {
          checks.push(decided(plan.result));
        } else {
          checks.push(
            decided({
              rubricId: rubric.id,
              rubricVersion: rubric.version,
              kind: rubric.kind,
              severity: rubric.severity,
              required: rubric.required,
              status: "error",
              reason: `judge request failed: ${info.message}`,
              criterion: rubric.criterion,
              questionKeys: Object.keys(plan.questions),
              thresholds: rubric.thresholds ?? thresholds,
              evidence,
              error: info,
            }),
          );
        }
      }
    }
  } else {
    for (const { plan } of plans) {
      if (plan.kind === "decided") checks.push(decided(plan.result));
    }
  }

  const result: CaseResult = { caseId: parsed.id, startedAt, finishedAt: new Date().toISOString(), checks };
  if (request) result.request = request;
  if (caseError) result.error = caseError;
  if (parsed.metadata) result.metadata = parsed.metadata;
  return result;
}

/** Bounded-concurrency map preserving input order. */
async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function datasetFingerprint(cases: readonly EvalCase[]): string {
  // Expected labels and metadata are excluded so relabelling does not change the fingerprint.
  return fingerprint(
    stableStringify(cases.map(({ expected: _e, metadata: _m, ...rest }) => rest)),
  );
}

export function estimateCost(inputTokens: number, pricing: PricingConfig | undefined): CostEstimate | null {
  if (!pricing) return null;
  return {
    estimated: true,
    currency: "USD",
    amount: (inputTokens / 1_000_000) * pricing.inputPerMillionTokensUsd,
    inputRatePerMillionTokens: pricing.inputPerMillionTokensUsd,
    rateAsOf: pricing.asOf,
    rateSource: pricing.source,
    note: "Estimate from configured rate and measured input tokens. Verify against your provider invoice.",
  };
}

/**
 * Evaluate a dataset. Per-case failures are recorded and the run continues; the summary
 * reflects every status including errors. Cancel with `signal` to stop scheduling new cases.
 */
export async function evaluateDataset(cases: readonly EvalCase[], rubrics: readonly Rubric[], options: DatasetOptions): Promise<RunReport> {
  const createdAt = new Date().toISOString();
  const thresholds = ThresholdsSchema.parse(options.thresholds ?? DEFAULT_THRESHOLDS);
  const parsedCases = cases.map((c) => EvalCaseSchema.parse(c));
  const seen = new Set<string>();
  for (const c of parsedCases) {
    if (seen.has(c.id)) throw new Error(`duplicate case id '${c.id}' in dataset`);
    seen.add(c.id);
  }
  for (const r of rubrics) validateRubric(r);
  const rubricIds = new Set<string>();
  for (const r of rubrics) {
    if (rubricIds.has(r.id)) throw new Error(`duplicate rubric id '${r.id}'`);
    rubricIds.add(r.id);
  }

  const concurrency = options.concurrency ?? 4;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 3;

  const results = await mapPool(parsedCases, concurrency, async (evalCase, index) => {
    if (options.signal?.aborted) {
      return {
        caseId: evalCase.id,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        checks: rubrics.map<CheckResult>((rubric) => ({
          caseId: evalCase.id,
          rubricId: rubric.id,
          rubricVersion: rubric.version,
          kind: rubric.kind,
          severity: rubric.severity,
          required: rubric.required,
          status: "error",
          reason: "run cancelled before this case was evaluated",
          criterion: rubric.criterion,
          questionKeys: [],
          thresholds: rubric.thresholds ?? thresholds,
          evidence: { fields: [], policy: false, contextIds: [], toolEventIds: [], messageIds: [] },
          error: { kind: "aborted", message: "cancelled" },
        })),
        error: { kind: "aborted", message: "run cancelled", attempts: 0 },
      } satisfies CaseResult;
    }
    const evalOpts: EvaluateOptions = { provider: options.provider, thresholds, timeoutMs, maxAttempts };
    if (options.model !== undefined) evalOpts.model = options.model;
    if (options.signal) evalOpts.signal = options.signal;
    if (options.digest !== undefined) evalOpts.digest = options.digest;
    if (options.sleep) evalOpts.sleep = options.sleep;
    if (options.onRetry) evalOpts.onRetry = options.onRetry;
    const result = await evaluateCase(evalCase, rubrics, evalOpts);
    options.onCaseComplete?.(result, index, parsedCases.length);
    return result;
  });

  const summary = summarize(results, rubrics);
  const modelsSeen = new Set(results.map((r) => r.request?.model).filter((m): m is string => typeof m === "string"));
  const report: RunReport = {
    schemaVersion: 1,
    runId: globalThis.crypto.randomUUID(),
    createdAt,
    mode: options.provider.simulated ? "fixture" : "live",
    simulated: options.provider.simulated,
    provider: {
      id: options.provider.id,
      model: modelsSeen.size === 1 ? [...modelsSeen][0]! : modelsSeen.size === 0 ? null : [...modelsSeen].sort().join(","),
      requestedModel: options.model ?? options.provider.defaultModel,
    },
    dataset: {
      path: options.datasetPath ?? null,
      fingerprint: datasetFingerprint(parsedCases),
      caseCount: parsedCases.length,
    },
    rubrics: rubrics.map((r) => ({
      id: r.id,
      version: r.version,
      kind: r.kind,
      severity: r.severity,
      required: r.required,
      fingerprint: fingerprint(rubricFingerprint(r)),
    })),
    thresholds,
    settings: { concurrency, timeoutMs, maxAttempts },
    summary,
    cases: results,
    cost: options.provider.simulated ? null : estimateCost(summary.usage.inputTokens, options.pricing),
  };
  if (options.provenance !== undefined) report.dataset.provenance = options.provenance;
  if (options.labels) report.labels = { ...options.labels };
  return report;
}
