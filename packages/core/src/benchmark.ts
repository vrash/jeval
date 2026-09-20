import type { RunReport } from "./results.js";
import type { CheckStatus, LabelRecord } from "./schemas.js";

export interface ConfusionCounts {
  /** predicted fail, labelled fail */
  truePositive: number;
  /** predicted fail, labelled pass */
  falsePositive: number;
  /** predicted pass, labelled fail */
  falseNegative: number;
  /** predicted pass, labelled pass */
  trueNegative: number;
}

export interface CalibrationBin {
  range: [number, number];
  count: number;
  meanPredicted: number;
  observedFailRate: number;
}

export interface AutomationPoint {
  /** Decide only when max(scores.acceptable, scores.unacceptable) ≥ threshold. */
  threshold: number;
  decided: number;
  decidedShare: number;
  /** Share of decided checks whose pass/fail matched the label. */
  accuracy: number | null;
  failPrecision: number | null;
  /** Recall against all labelled failures, including those left undecided. */
  failRecall: number | null;
}

export interface AutomationCurve {
  /** Binary-labelled checks that carried decision scores. */
  sample: number;
  points: AutomationPoint[];
  /** Lowest threshold whose accuracy meets `targetAccuracy` with at least `minDecided` decided checks, if requested. */
  suggestion?: { targetAccuracy: number; threshold: number; decidedShare: number; accuracy: number } | { targetAccuracy: number; threshold: null; reason: string };
}

export interface BenchmarkResult {
  /** Labels matched to a check in the run. */
  sampleCount: number;
  labelsWithoutPrediction: number;
  predictionsWithoutLabel: number;
  /** Labels whose expected status is pass or fail. */
  binaryLabelCount: number;
  /** Labels whose expected status is review or skipped, evaluated separately. */
  undecidableLabelCount: number;
  labelSources: Record<string, number>;
  /** Failure detection over binary labels where the prediction was decided (pass or fail). */
  failureDetection: {
    decided: number;
    confusion: ConfusionCounts;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  };
  /** Abstention on binary labels: how often the judge said review or skipped. */
  abstention: {
    review: number;
    skipped: number;
    error: number;
    reviewRateOnBinary: number | null;
    reviewOnLabelledFail: number;
    reviewOnLabelledPass: number;
  };
  /** Agreement on undecidable labels: predicted review/skipped when the label says so. */
  undecidable: { agree: number; predictedDecided: number; error: number; agreementRate: number | null };
  executionErrors: number;
  /** Full status agreement matrix expected -> predicted -> count. */
  matrix: Record<string, Record<CheckStatus, number>>;
  /** Accuracy versus share of checks decided automatically, as the decision threshold rises. */
  automation: AutomationCurve;
  calibration: {
    computed: boolean;
    reason?: string;
    bins?: CalibrationBin[];
    expectedCalibrationError?: number | null;
    sample?: number;
  };
  latencyMs: RunReport["summary"]["latencyMs"];
  usage: RunReport["summary"]["usage"];
  simulated: boolean;
  mode: RunReport["mode"];
  model: string | null;
}

function safeDiv(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

function emptyStatusCounts(): Record<CheckStatus, number> {
  return { pass: 0, fail: 0, review: 0, skipped: 0, error: 0 };
}

type Check = RunReport["cases"][number]["checks"][number];

/** Probability assigned to the unacceptable-style outcome when one three-way question decided the check. */
function failProbability(check: Check): number | null {
  if (!check.answers || check.questionKeys.length !== 1) return null;
  const answer = check.answers[check.questionKeys[0]!];
  if (!answer) return null;
  const p = answer.probabilities;
  const v = p["unacceptable"] ?? p["contradicted"];
  return typeof v === "number" ? v : null;
}

export interface BenchmarkOptions {
  /** Minimum binary labels with probabilities before calibration is computed. Default 20. */
  minCalibrationSamples?: number;
  bins?: number;
  /** Ask the automation curve for the lowest threshold that reaches this accuracy (0..1). */
  targetAccuracy?: number;
  /** Minimum decided checks for a suggestion to count. Default 20. */
  minDecidedForSuggestion?: number;
}

export function automationCurve(samples: ReadonlyArray<{ acceptable: number; unacceptable: number; fail: boolean }>, options: { targetAccuracy?: number; minDecided?: number } = {}): AutomationCurve {
  const points: AutomationPoint[] = [];
  const totalFails = samples.filter((s) => s.fail).length;
  for (let t = 0.5; t <= 0.951; t += 0.05) {
    const th = Math.round(t * 100) / 100;
    const decided = samples.filter((s) => Math.max(s.acceptable, s.unacceptable) >= th);
    let correct = 0, tp = 0, fp = 0;
    for (const s of decided) {
      const predFail = s.unacceptable >= s.acceptable;
      if (predFail === s.fail) correct += 1;
      if (predFail && s.fail) tp += 1;
      if (predFail && !s.fail) fp += 1;
    }
    points.push({
      threshold: th,
      decided: decided.length,
      decidedShare: samples.length ? decided.length / samples.length : 0,
      accuracy: decided.length ? correct / decided.length : null,
      failPrecision: tp + fp ? tp / (tp + fp) : null,
      failRecall: totalFails ? tp / totalFails : null,
    });
  }
  const curve: AutomationCurve = { sample: samples.length, points };
  if (options.targetAccuracy !== undefined) {
    const minDecided = options.minDecided ?? 20;
    const hit = points.find((p) => p.accuracy !== null && p.accuracy >= options.targetAccuracy! && p.decided >= minDecided);
    curve.suggestion = hit
      ? { targetAccuracy: options.targetAccuracy, threshold: hit.threshold, decidedShare: hit.decidedShare, accuracy: hit.accuracy! }
      : { targetAccuracy: options.targetAccuracy, threshold: null, reason: `no threshold between 0.5 and 0.95 reaches ${(options.targetAccuracy * 100).toFixed(0)}% accuracy with at least ${minDecided} decided checks` };
  }
  return curve;
}

export function benchmarkRun(report: RunReport, labels: readonly LabelRecord[], options: BenchmarkOptions = {}): BenchmarkResult {
  const minCal = options.minCalibrationSamples ?? 20;
  const binCount = options.bins ?? 5;
  const predictions = new Map<string, Check>();
  for (const c of report.cases) {
    for (const ch of c.checks) {
      predictions.set(`${c.caseId}\n${ch.rubricId}`, ch);
      // Sentence-level parts can be labelled separately as `<rubricId>#<partId>`.
      for (const part of ch.parts ?? []) {
        const { parts: _parts, scores: _scores, ...rest } = ch;
        const answer = ch.answers?.[part.questionKey];
        const pseudo: Check = { ...rest, status: part.status, outcome: part.outcome, reason: part.reason, questionKeys: [part.questionKey], answers: answer ? { [part.questionKey]: answer } : {} };
        if (part.scores) pseudo.scores = part.scores;
        predictions.set(`${c.caseId}\n${ch.rubricId}#${part.id}`, pseudo);
      }
    }
  }

  const matrix: Record<string, Record<CheckStatus, number>> = {};
  const confusion: ConfusionCounts = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 };
  const abst = { review: 0, skipped: 0, error: 0, reviewOnLabelledFail: 0, reviewOnLabelledPass: 0 };
  const und = { agree: 0, predictedDecided: 0, error: 0 };
  const labelSources: Record<string, number> = {};
  let sampleCount = 0;
  let labelsWithoutPrediction = 0;
  let binaryLabelCount = 0;
  let undecidableLabelCount = 0;
  let executionErrors = 0;
  const calibrationSamples: Array<{ p: number; fail: boolean }> = [];
  const scoreSamples: Array<{ acceptable: number; unacceptable: number; fail: boolean }> = [];
  const matched = new Set<string>();

  for (const label of labels) {
    const k = `${label.caseId}\n${label.rubricId}`;
    const pred = predictions.get(k);
    if (!pred) {
      labelsWithoutPrediction += 1;
      continue;
    }
    matched.add(k);
    sampleCount += 1;
    labelSources[label.source] = (labelSources[label.source] ?? 0) + 1;
    const row = (matrix[label.expected] ??= emptyStatusCounts());
    row[pred.status] += 1;
    if (pred.status === "error") executionErrors += 1;

    if (label.expected === "pass" || label.expected === "fail") {
      binaryLabelCount += 1;
      const labelledFail = label.expected === "fail";
      if (pred.status === "fail") {
        if (labelledFail) confusion.truePositive++;
        else confusion.falsePositive++;
      } else if (pred.status === "pass") {
        if (labelledFail) confusion.falseNegative++;
        else confusion.trueNegative++;
      } else if (pred.status === "review") {
        abst.review += 1;
        if (labelledFail) abst.reviewOnLabelledFail++;
        else abst.reviewOnLabelledPass++;
      } else if (pred.status === "skipped") abst.skipped += 1;
      else abst.error += 1;
      const p = failProbability(pred);
      if (p !== null && pred.status !== "error") calibrationSamples.push({ p, fail: labelledFail });
      if (pred.scores && pred.status !== "error") scoreSamples.push({ acceptable: pred.scores.acceptable, unacceptable: pred.scores.unacceptable, fail: labelledFail });
    } else {
      undecidableLabelCount += 1;
      if (pred.status === "review" || pred.status === "skipped") und.agree += 1;
      else if (pred.status === "error") und.error += 1;
      else und.predictedDecided += 1;
    }
  }

  const decided = confusion.truePositive + confusion.falsePositive + confusion.falseNegative + confusion.trueNegative;
  const precision = safeDiv(confusion.truePositive, confusion.truePositive + confusion.falsePositive);
  const recall = safeDiv(confusion.truePositive, confusion.truePositive + confusion.falseNegative);
  const f1 =
    precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);

  let calibration: BenchmarkResult["calibration"];
  if (calibrationSamples.length < minCal) {
    calibration = {
      computed: false,
      reason: `only ${calibrationSamples.length} binary-labelled checks carry a single deciding probability; at least ${minCal} are needed`,
      sample: calibrationSamples.length,
    };
  } else {
    const bins: CalibrationBin[] = [];
    let ece = 0;
    for (let i = 0; i < binCount; i++) {
      const lo = i / binCount;
      const hi = (i + 1) / binCount;
      const last = i === binCount - 1;
      const inBin = calibrationSamples.filter((s) => s.p >= lo && (last ? s.p <= hi : s.p < hi));
      if (inBin.length === 0) {
        bins.push({ range: [lo, hi], count: 0, meanPredicted: 0, observedFailRate: 0 });
        continue;
      }
      const meanPredicted = inBin.reduce((a, s) => a + s.p, 0) / inBin.length;
      const observed = inBin.filter((s) => s.fail).length / inBin.length;
      bins.push({ range: [lo, hi], count: inBin.length, meanPredicted, observedFailRate: observed });
      ece += (inBin.length / calibrationSamples.length) * Math.abs(meanPredicted - observed);
    }
    calibration = { computed: true, bins, expectedCalibrationError: ece, sample: calibrationSamples.length };
  }

  return {
    sampleCount,
    labelsWithoutPrediction,
    predictionsWithoutLabel: predictions.size - matched.size,
    binaryLabelCount,
    undecidableLabelCount,
    labelSources,
    failureDetection: { decided, confusion, precision, recall, f1 },
    abstention: { ...abst, reviewRateOnBinary: safeDiv(abst.review, binaryLabelCount) },
    undecidable: { ...und, agreementRate: safeDiv(und.agree, undecidableLabelCount) },
    executionErrors,
    matrix,
    automation: automationCurve(scoreSamples, { ...(options.targetAccuracy !== undefined ? { targetAccuracy: options.targetAccuracy } : {}), ...(options.minDecidedForSuggestion !== undefined ? { minDecided: options.minDecidedForSuggestion } : {}) }),
    calibration,
    latencyMs: report.summary.latencyMs,
    usage: report.summary.usage,
    simulated: report.simulated,
    mode: report.mode,
    model: report.provider.model,
  };
}
