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
}

export function benchmarkRun(report: RunReport, labels: readonly LabelRecord[], options: BenchmarkOptions = {}): BenchmarkResult {
  const minCal = options.minCalibrationSamples ?? 20;
  const binCount = options.bins ?? 5;
  const predictions = new Map<string, Check>();
  for (const c of report.cases) for (const ch of c.checks) predictions.set(`${c.caseId}\n${ch.rubricId}`, ch);

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
    calibration,
    latencyMs: report.summary.latencyMs,
    usage: report.summary.usage,
    simulated: report.simulated,
    mode: report.mode,
    model: report.provider.model,
  };
}
