import type { CheckStatus } from "./schemas.js";
import type { RunReport } from "./results.js";

export interface CompatibilityIssue {
  field: "dataset" | "rubrics" | "model" | "thresholds" | "mode" | "provider";
  severity: "warning" | "error";
  message: string;
}

export interface CheckTransition {
  caseId: string;
  rubricId: string;
  before: CheckStatus | null;
  after: CheckStatus | null;
  beforeReason?: string;
  afterReason?: string;
}

export interface Comparison {
  baseline: { runId: string; createdAt: string; mode: RunReport["mode"]; model: string | null };
  candidate: { runId: string; createdAt: string; mode: RunReport["mode"]; model: string | null };
  compatibility: { compatible: boolean; issues: CompatibilityIssue[] };
  alignment: { sharedCases: number; onlyInBaseline: string[]; onlyInCandidate: string[]; sharedRubrics: string[] };
  counts: { baseline: Record<CheckStatus, number>; candidate: Record<CheckStatus, number> };
  newFailures: CheckTransition[];
  resolvedFailures: CheckTransition[];
  newReviews: CheckTransition[];
  newErrors: CheckTransition[];
  otherChanges: CheckTransition[];
  unchanged: number;
}

// Ids cannot contain newlines, so this composite key is unambiguous.
function key(caseId: string, rubricId: string): string {
  return `${caseId}\n${rubricId}`;
}

export function compareRuns(baseline: RunReport, candidate: RunReport): Comparison {
  const issues: CompatibilityIssue[] = [];
  if (baseline.dataset.fingerprint !== candidate.dataset.fingerprint) {
    issues.push({
      field: "dataset",
      severity: "warning",
      message: `datasets differ (${baseline.dataset.caseCount} vs ${candidate.dataset.caseCount} cases, fingerprints ${baseline.dataset.fingerprint} vs ${candidate.dataset.fingerprint}); only shared case ids are compared`,
    });
  }
  const bRub = new Map(baseline.rubrics.map((r) => [r.id, r]));
  const cRub = new Map(candidate.rubrics.map((r) => [r.id, r]));
  for (const [id, r] of bRub) {
    const other = cRub.get(id);
    if (!other) issues.push({ field: "rubrics", severity: "warning", message: `rubric '${id}' exists only in the baseline` });
    else if (other.version !== r.version || other.fingerprint !== r.fingerprint) {
      issues.push({ field: "rubrics", severity: "error", message: `rubric '${id}' changed (version ${r.version} → ${other.version}); its results are not comparable` });
    }
  }
  for (const id of cRub.keys()) {
    if (!bRub.has(id)) issues.push({ field: "rubrics", severity: "warning", message: `rubric '${id}' exists only in the candidate` });
  }
  if (baseline.provider.model !== candidate.provider.model) {
    issues.push({ field: "model", severity: "warning", message: `models differ: ${baseline.provider.model ?? "unknown"} vs ${candidate.provider.model ?? "unknown"}` });
  }
  if (baseline.provider.id !== candidate.provider.id) {
    issues.push({ field: "provider", severity: "warning", message: `providers differ: ${baseline.provider.id} vs ${candidate.provider.id}` });
  }
  if (baseline.mode !== candidate.mode) {
    issues.push({ field: "mode", severity: "error", message: `modes differ: ${baseline.mode} vs ${candidate.mode}; simulated and live runs are not comparable` });
  }
  if (baseline.thresholds.pass !== candidate.thresholds.pass || baseline.thresholds.fail !== candidate.thresholds.fail) {
    issues.push({
      field: "thresholds",
      severity: "warning",
      message: `thresholds differ: pass ${baseline.thresholds.pass}/fail ${baseline.thresholds.fail} vs pass ${candidate.thresholds.pass}/fail ${candidate.thresholds.fail}`,
    });
  }

  const bChecks = new Map<string, { status: CheckStatus; reason: string }>();
  for (const c of baseline.cases) for (const ch of c.checks) bChecks.set(key(c.caseId, ch.rubricId), { status: ch.status, reason: ch.reason });
  const cChecks = new Map<string, { status: CheckStatus; reason: string }>();
  for (const c of candidate.cases) for (const ch of c.checks) cChecks.set(key(c.caseId, ch.rubricId), { status: ch.status, reason: ch.reason });

  const bCases = new Set(baseline.cases.map((c) => c.caseId));
  const cCases = new Set(candidate.cases.map((c) => c.caseId));
  const shared = [...bCases].filter((id) => cCases.has(id));
  const sharedRubrics = [...bRub.keys()].filter((id) => {
    const other = cRub.get(id);
    const mine = bRub.get(id);
    return other && mine && other.version === mine.version && other.fingerprint === mine.fingerprint;
  });

  const comparison: Comparison = {
    baseline: { runId: baseline.runId, createdAt: baseline.createdAt, mode: baseline.mode, model: baseline.provider.model },
    candidate: { runId: candidate.runId, createdAt: candidate.createdAt, mode: candidate.mode, model: candidate.provider.model },
    compatibility: { compatible: issues.every((i) => i.severity !== "error"), issues },
    alignment: {
      sharedCases: shared.length,
      onlyInBaseline: [...bCases].filter((id) => !cCases.has(id)),
      onlyInCandidate: [...cCases].filter((id) => !bCases.has(id)),
      sharedRubrics,
    },
    counts: { baseline: baseline.summary.counts, candidate: candidate.summary.counts },
    newFailures: [],
    resolvedFailures: [],
    newReviews: [],
    newErrors: [],
    otherChanges: [],
    unchanged: 0,
  };

  for (const caseId of shared) {
    for (const rubricId of sharedRubrics) {
      const before = bChecks.get(key(caseId, rubricId));
      const after = cChecks.get(key(caseId, rubricId));
      if (!before || !after) continue;
      if (before.status === after.status) {
        comparison.unchanged += 1;
        continue;
      }
      const t: CheckTransition = { caseId, rubricId, before: before.status, after: after.status, beforeReason: before.reason, afterReason: after.reason };
      if (after.status === "fail") comparison.newFailures.push(t);
      else if (before.status === "fail" && after.status === "pass") comparison.resolvedFailures.push(t);
      else if (after.status === "review") comparison.newReviews.push(t);
      else if (after.status === "error") comparison.newErrors.push(t);
      else comparison.otherChanges.push(t);
    }
  }
  return comparison;
}
