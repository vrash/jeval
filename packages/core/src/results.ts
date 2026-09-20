import type { JsonValue } from "./json.js";
import type { ChoiceQuestionSpec, JudgeUsage } from "./provider.js";
import type { CheckStatus, RubricKind, Severity, Thresholds } from "./schemas.js";
import type { DigestRecord } from "./digest.js";

export interface CheckEvidence {
  /** State fields the judge saw for this case. */
  fields: string[];
  policy: boolean;
  contextIds: string[];
  toolEventIds: string[];
  messageIds: string[];
  /** Present when the judge state was shrunk to fit the provider's input limit. */
  digest?: DigestRecord;
}

export interface CheckResult {
  caseId: string;
  rubricId: string;
  rubricVersion: string;
  kind: RubricKind;
  severity: Severity;
  required: boolean;
  status: CheckStatus;
  /** Selected outcome label for the deciding question, when a question was asked. */
  outcome?: string;
  /** Why this status was produced: threshold rule, deterministic rule, or missing evidence. */
  reason: string;
  /** Deterministic rule applied by code, when one contributed to the decision. */
  rule?: string;
  /** The exact criterion shown to the judge (the deciding question's instructions). */
  criterion: string;
  /** Question keys in the batched request that this check consumed. */
  questionKeys: string[];
  /** Answers for each consumed question, preserving full probabilities and provider confidence. */
  answers?: Record<string, { choice: string; confidence: number; probabilities: Record<string, number> }>;
  thresholds: Thresholds;
  evidence: CheckEvidence;
  error?: { kind: string; message: string };
}

export interface RequestRecord {
  provider: string;
  model: string;
  simulated: boolean;
  requestId?: string;
  latencyMs: number;
  /** Usage for the whole batched request. Do not sum across checks; sum across requests. */
  usage: JudgeUsage;
  attempts: number;
  questionCount: number;
  /** Serialised questions as sent, for audit. */
  questions: Record<string, ChoiceQuestionSpec>;
  notes?: string[];
}

export interface CaseResult {
  caseId: string;
  startedAt: string;
  finishedAt: string;
  checks: CheckResult[];
  /** Present when a judge request was made for this case. */
  request?: RequestRecord;
  /** Present when the case could not be evaluated at all (e.g. provider failure after retries). */
  error?: { kind: string; message: string; attempts: number };
  /** Copy of the case metadata so reports can group results. Never sent to the judge. */
  metadata?: Record<string, JsonValue>;
}

export type StatusCounts = Record<CheckStatus, number>;

export interface RubricSummary {
  rubricId: string;
  rubricVersion: string;
  severity: Severity;
  required: boolean;
  counts: StatusCounts;
  /** pass / (pass + fail) or null when no check was decided. */
  passRateDecided: number | null;
  /** (pass + fail) / (total - skipped) or null when nothing was applicable. */
  decidedCoverage: number | null;
}

export interface RunSummary {
  caseCount: number;
  /** Cases with a case-level error (no checks evaluated). */
  caseErrors: number;
  checkCount: number;
  counts: StatusCounts;
  /** pass / (pass + fail). Denominator excludes review, skipped and error. */
  passRateDecided: number | null;
  /** pass / (total - skipped). Review and error count against the rate. */
  passRateApplicable: number | null;
  /** (pass + fail) / (total - skipped). */
  decidedCoverage: number | null;
  reviewRate: number | null;
  errorRate: number | null;
  /** Failures on critical-severity rubrics. Surfaced separately so they cannot hide in an average. */
  criticalFailures: number;
  perRubric: RubricSummary[];
  latencyMs: { count: number; mean: number | null; p50: number | null; p95: number | null; max: number | null };
  usage: { requests: number; inputTokens: number; outputTokens: number };
}

export interface CostEstimate {
  /** Always an estimate computed from configured rates, never a billed amount. */
  estimated: true;
  currency: "USD";
  amount: number;
  inputRatePerMillionTokens: number;
  rateAsOf: string;
  rateSource: string;
  note: string;
}

export interface RunReport {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  /** `fixture` results are simulated and must never be presented as measurements. */
  mode: "fixture" | "live";
  simulated: boolean;
  provider: { id: string; model: string | null; requestedModel: string | null };
  dataset: { path: string | null; fingerprint: string; caseCount: number; provenance?: string };
  rubrics: Array<{ id: string; version: string; kind: RubricKind; severity: Severity; required: boolean; fingerprint: string }>;
  thresholds: Thresholds;
  settings: { concurrency: number; timeoutMs: number; maxAttempts: number };
  summary: RunSummary;
  cases: CaseResult[];
  /** Unknown cost is represented by `null`, never zero. */
  cost: CostEstimate | null;
  /** Free-form labels such as git commit or model alias. */
  labels?: Record<string, string>;
}

export function emptyCounts(): StatusCounts {
  return { pass: 0, fail: 0, review: 0, skipped: 0, error: 0 };
}
