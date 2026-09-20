import type { RunReport } from "./results.js";
import { z } from "zod";

/**
 * CI gate policy. The strict default succeeds only when every required check on every case
 * reached a decision and no failure occurred. Loosen deliberately and document why.
 */
export const GatePolicySchema = z.object({
  /** Maximum failed required checks. Default 0. */
  maxFailures: z.number().int().min(0).default(0),
  /** Maximum critical-severity failures, regardless of `maxFailures`. Default 0. */
  maxCriticalFailures: z.number().int().min(0).default(0),
  /** Maximum share of applicable required checks that ended in review (0..1). Default 0. */
  maxReviewRate: z.number().min(0).max(1).default(0),
  /** Minimum share of applicable required checks that were decided (0..1). Default 1. */
  minDecidedCoverage: z.number().min(0).max(1).default(1),
  /** Whether execution errors on required checks are tolerated. Default false. */
  allowErrors: z.boolean().default(false),
  /** Whether a required rubric may be skipped on every case without failing the gate. Default false. */
  allowSkippedRequired: z.boolean().default(false),
  /** Whether an empty dataset counts as success. Default false. */
  allowEmptyDataset: z.boolean().default(false),
  /** Whether simulated (fixture) runs may pass the gate. Default false: CI should judge real outputs. */
  allowSimulated: z.boolean().default(false),
});
export type GatePolicy = z.infer<typeof GatePolicySchema>;
export type GatePolicyInput = z.input<typeof GatePolicySchema>;

export const DEFAULT_GATE_POLICY: GatePolicy = GatePolicySchema.parse({});

/**
 * Exit codes for `jeval run --ci`.
 * 0 success · 1 quality gate failed · 2 run incomplete (errors, review, empty, skipped required) · 3 usage/config error
 */
export const EXIT = { ok: 0, gateFailed: 1, incomplete: 2, usage: 3 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface GateResult {
  ok: boolean;
  exitCode: ExitCode;
  /** Human-readable reasons, empty when ok. */
  reasons: string[];
  metrics: {
    requiredChecks: number;
    applicable: number;
    failures: number;
    criticalFailures: number;
    reviews: number;
    errors: number;
    decidedCoverage: number | null;
    reviewRate: number | null;
  };
}

export function evaluateGates(report: RunReport, policyInput: GatePolicyInput = {}): GateResult {
  const policy = GatePolicySchema.parse(policyInput);
  const reasons: string[] = [];
  let incomplete = false;
  let gateFailed = false;

  if (report.summary.caseCount === 0 && !policy.allowEmptyDataset) {
    reasons.push("dataset is empty (set allowEmptyDataset to accept this)");
    incomplete = true;
  }
  if (report.simulated && !policy.allowSimulated) {
    reasons.push("run used a simulated provider; CI gates require real judgments (set allowSimulated to accept this)");
    incomplete = true;
  }

  const requiredIds = new Set(report.rubrics.filter((r) => r.required).map((r) => r.id));
  const checks = report.cases.flatMap((c) => c.checks).filter((c) => requiredIds.has(c.rubricId));
  let failures = 0;
  let criticalFailures = 0;
  let reviews = 0;
  let errors = 0;
  let skipped = 0;
  for (const c of checks) {
    if (c.status === "fail") {
      failures += 1;
      if (c.severity === "critical") criticalFailures += 1;
    } else if (c.status === "review") reviews += 1;
    else if (c.status === "error") errors += 1;
    else if (c.status === "skipped") skipped += 1;
  }
  const applicable = checks.length - skipped;
  const decidedCoverage = applicable === 0 ? null : (applicable - reviews - errors) / applicable;
  const reviewRate = applicable === 0 ? null : reviews / applicable;

  if (report.summary.caseErrors > 0 && !policy.allowErrors) {
    reasons.push(`${report.summary.caseErrors} case(s) could not be evaluated (provider errors)`);
    incomplete = true;
  }
  if (errors > 0 && !policy.allowErrors) {
    reasons.push(`${errors} required check(s) ended in error`);
    incomplete = true;
  }
  if (reviewRate !== null && reviewRate > policy.maxReviewRate) {
    reasons.push(`review rate ${(reviewRate * 100).toFixed(1)}% exceeds maxReviewRate ${(policy.maxReviewRate * 100).toFixed(1)}%`);
    incomplete = true;
  }
  if (decidedCoverage !== null && decidedCoverage < policy.minDecidedCoverage) {
    reasons.push(`decided coverage ${(decidedCoverage * 100).toFixed(1)}% is below minDecidedCoverage ${(policy.minDecidedCoverage * 100).toFixed(1)}%`);
    incomplete = true;
  }
  if (!policy.allowSkippedRequired && report.summary.caseCount > 0) {
    for (const id of requiredIds) {
      const forRubric = checks.filter((c) => c.rubricId === id);
      if (forRubric.length > 0 && forRubric.every((c) => c.status === "skipped")) {
        reasons.push(`required rubric '${id}' was skipped on every case (set allowSkippedRequired to accept this)`);
        incomplete = true;
      }
    }
  }
  if (criticalFailures > policy.maxCriticalFailures) {
    reasons.push(`${criticalFailures} critical failure(s) exceed maxCriticalFailures ${policy.maxCriticalFailures}`);
    gateFailed = true;
  }
  if (failures > policy.maxFailures) {
    reasons.push(`${failures} failed required check(s) exceed maxFailures ${policy.maxFailures}`);
    gateFailed = true;
  }

  const exitCode: ExitCode = gateFailed ? EXIT.gateFailed : incomplete ? EXIT.incomplete : EXIT.ok;
  return {
    ok: exitCode === EXIT.ok,
    exitCode,
    reasons,
    metrics: { requiredChecks: checks.length, applicable, failures, criticalFailures, reviews, errors, decidedCoverage, reviewRate },
  };
}
