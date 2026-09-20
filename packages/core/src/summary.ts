import type { CaseResult, RubricSummary, RunSummary, StatusCounts } from "./results.js";
import { emptyCounts } from "./results.js";
import type { Rubric } from "./schemas.js";

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function summarize(results: readonly CaseResult[], rubrics: readonly Rubric[]): RunSummary {
  const counts = emptyCounts();
  const perRubricCounts = new Map<string, StatusCounts>();
  for (const r of rubrics) perRubricCounts.set(r.id, emptyCounts());
  let criticalFailures = 0;
  let checkCount = 0;
  const latencies: number[] = [];
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };

  for (const result of results) {
    if (result.request) {
      usage.requests += 1;
      usage.inputTokens += result.request.usage.inputTokens;
      usage.outputTokens += result.request.usage.outputTokens;
      latencies.push(result.request.latencyMs);
    }
    for (const check of result.checks) {
      checkCount += 1;
      counts[check.status] += 1;
      const pr = perRubricCounts.get(check.rubricId) ?? emptyCounts();
      pr[check.status] += 1;
      perRubricCounts.set(check.rubricId, pr);
      if (check.status === "fail" && check.severity === "critical") criticalFailures += 1;
    }
  }

  const applicable = checkCount - counts.skipped;
  const decided = counts.pass + counts.fail;
  const perRubric: RubricSummary[] = rubrics.map((r) => {
    const c = perRubricCounts.get(r.id) ?? emptyCounts();
    const total = c.pass + c.fail + c.review + c.skipped + c.error;
    return {
      rubricId: r.id,
      rubricVersion: r.version,
      severity: r.severity,
      required: r.required,
      counts: c,
      passRateDecided: ratio(c.pass, c.pass + c.fail),
      decidedCoverage: ratio(c.pass + c.fail, total - c.skipped),
    };
  });

  latencies.sort((a, b) => a - b);
  return {
    caseCount: results.length,
    caseErrors: results.filter((r) => r.error).length,
    checkCount,
    counts,
    passRateDecided: ratio(counts.pass, decided),
    passRateApplicable: ratio(counts.pass, applicable),
    decidedCoverage: ratio(decided, applicable),
    reviewRate: ratio(counts.review, applicable),
    errorRate: ratio(counts.error, applicable),
    criticalFailures,
    perRubric,
    latencyMs: {
      count: latencies.length,
      mean: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.length ? latencies[latencies.length - 1]! : null,
    },
    usage,
  };
}
