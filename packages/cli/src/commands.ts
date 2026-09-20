import { existsSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import {
  EXIT,
  FixtureFileSchema,
  FixtureProvider,
  benchmarkRun,
  compareRuns,
  evaluateDataset,
  evaluateGates,
  estimateRun,
  renderComparisonHtml,
  renderRunHtml,
  toJsonl,
  type BenchmarkResult,
  type CheckStatus,
  type Comparison,
  type LabelRecord,
  type RunEstimate,
  type GateResult,
  type JudgeProvider,
  type RunReport,
} from "@jeval/core";
import { JevProvider } from "@jeval/provider-jev";
import { buildJudgeState, importJsonl, detectImportFormat, type ImportFormat, type ImportOptions } from "@jeval/core";
import { CliError, loadConfig, loadDataset, loadEnvFile, loadLabels, loadRubrics, loadRun, readJson, timestampSlug, writeFileSafe } from "./io.js";
import { starterFiles } from "./templates.js";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function fmtPct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

export async function initCommand(dir: string | undefined, io: Io): Promise<number> {
  const target = resolve(io.cwd, dir ?? ".");
  const files = starterFiles();
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    const path = join(target, name);
    if (existsSync(path)) {
      skipped.push(name);
      continue;
    }
    writeFileSafe(path, content, false);
    written.push(name);
  }
  for (const f of written) io.out(`created ${join(target, f)}`);
  for (const f of skipped) io.out(`kept existing ${join(target, f)}`);
  io.out("");
  io.out("Next:");
  io.out(`  cd ${target}`);
  io.out("  jeval run --mode fixture        # simulated, offline");
  io.out("  cp .env.example .env && jeval run --mode live   # real Jev, sends data to TypeSafe");
  return EXIT.ok;
}

export interface RunOptions {
  config?: string;
  mode?: "fixture" | "live";
  dataset?: string;
  rubrics?: string;
  out?: string;
  model?: string;
  concurrency?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  ci?: boolean;
  html?: boolean;
  quiet?: boolean;
  label?: string[];
  /** Evaluate only the first N cases (sample before scale). */
  limit?: number;
  /** Print the judged state beside each verdict. Opt-in: exposes case content on stdout. */
  show?: boolean;
  /** Refuse to start a live run whose estimated cost exceeds this amount (USD). Requires pricing in the config. */
  maxUsd?: number;
  provider?: JudgeProvider;
  signal?: AbortSignal;
}

/** Shared loading for run/estimate. */
function loadProject(opts: { config?: string; dataset?: string; rubrics?: string; limit?: number }, io: Io) {
  const { config, dir } = loadConfig(resolve(io.cwd, opts.config ?? "jeval.config.json"));
  loadEnvFile(dir);
  const datasetPath = resolve(dir, opts.dataset ?? config.dataset);
  const rubricsPath = resolve(dir, opts.rubrics ?? config.rubrics);
  const rubrics = loadRubrics(rubricsPath);
  let cases = loadDataset(datasetPath, (m) => io.err(`warning: ${m}`));
  const total = cases.length;
  if (opts.limit !== undefined) {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) throw new CliError("--limit must be a positive integer");
    cases = cases.slice(0, opts.limit);
  }
  return { config, dir, datasetPath, rubricsPath, rubrics, cases, total };
}

function fmtUsd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;
}

export function printEstimate(est: RunEstimate, io: Io, label = "estimate"): void {
  io.out(`${label}: ${est.caseCount} cases · ${est.requests} judge requests (${est.casesWithoutRequest} cases need none) · ~${est.estimatedInputTokens.toLocaleString()} input tokens`);
  io.out(`  method: ${est.method}; check against measured usage from a small live run`);
  io.out(`  cost: ${est.cost ? `~${fmtUsd(est.cost.amount)} (estimate at $${est.cost.inputRatePerMillionTokens}/M input tokens, rate as of ${est.cost.rateAsOf})` : "unknown (no pricing configured)"}`);
  const digested = est.cases.filter((c) => c.digested).length;
  if (digested > 0) io.out(`  ${digested} case(s) exceed the digest budget and will be shortened`);
}

export async function estimateCommand(opts: { config?: string; dataset?: string; rubrics?: string; limit?: number; json?: boolean }, io: Io): Promise<{ exitCode: number; estimate: RunEstimate }> {
  const { config, rubrics, cases } = loadProject(opts, io);
  const estOpts: Parameters<typeof estimateRun>[2] = {};
  if (config.thresholds) estOpts.thresholds = config.thresholds;
  if (config.pricing) estOpts.pricing = config.pricing;
  if (config.digest !== undefined) estOpts.digest = config.digest;
  const estimate = estimateRun(cases, rubrics, estOpts);
  if (opts.json) io.out(JSON.stringify(estimate, null, 2));
  else printEstimate(estimate, io);
  return { exitCode: EXIT.ok, estimate };
}

export async function runCommand(opts: RunOptions, io: Io): Promise<{ exitCode: number; report?: RunReport; gate?: GateResult; outPath?: string }> {
  const { config, dir, datasetPath, rubricsPath, rubrics, cases, total } = loadProject(opts, io);
  const mode = opts.mode ?? config.provider.mode;
  if (!mode) {
    throw new CliError("choose a provider mode explicitly: --mode fixture (simulated) or --mode live (real Jev, sends data to TypeSafe)");
  }
  if (opts.maxUsd !== undefined) {
    if (mode !== "live") io.err("note: --max-usd only applies to live runs");
    else {
      if (!config.pricing) throw new CliError("--max-usd needs `pricing` in jeval.config.json so the estimate can be priced");
      const estOpts: Parameters<typeof estimateRun>[2] = { pricing: config.pricing };
      if (config.thresholds) estOpts.thresholds = config.thresholds;
      if (config.digest !== undefined) estOpts.digest = config.digest;
      const est = estimateRun(cases, rubrics, estOpts);
      printEstimate(est, io, "pre-run estimate");
      if (est.cost && est.cost.amount > opts.maxUsd) {
        throw new CliError(`estimated cost ${fmtUsd(est.cost.amount)} exceeds --max-usd ${fmtUsd(opts.maxUsd)}; nothing was sent`);
      }
    }
  }

  let provider: JudgeProvider;
  if (opts.provider) {
    provider = opts.provider;
  } else if (mode === "fixture") {
    const fixturesPath = config.provider.fixtures ? resolve(dir, config.provider.fixtures) : undefined;
    const fixtures = fixturesPath && existsSync(fixturesPath) ? FixtureFileSchema.parse(readJson(fixturesPath)) : undefined;
    const fpOpts: ConstructorParameters<typeof FixtureProvider>[0] = { strict: config.provider.strictFixtures };
    if (fixtures) fpOpts.fixtures = fixtures;
    provider = new FixtureProvider(fpOpts);
    if (!fixtures) io.err(`warning: no fixture file found${fixturesPath ? ` at ${fixturesPath}` : ""}; using deterministic fallback answers`);
  } else {
    if (!io.env.TYPESAFE_API_KEY) {
      throw new CliError("live mode requires TYPESAFE_API_KEY (set it in the environment or a .env file next to jeval.config.json)");
    }
    const jevOpts: ConstructorParameters<typeof JevProvider>[0] = { apiKey: io.env.TYPESAFE_API_KEY, timeoutMs: opts.timeoutMs ?? config.timeoutMs };
    const model = opts.model ?? config.provider.model ?? io.env.TYPESAFE_DEFAULT_MODEL;
    if (model) jevOpts.model = model;
    if (io.env.TYPESAFE_BASE_URL) jevOpts.baseURL = io.env.TYPESAFE_BASE_URL;
    provider = new JevProvider(jevOpts);
  }

  if (!opts.quiet) {
    io.out(`jeval run · mode=${mode}${provider.simulated ? " (SIMULATED)" : ""} · provider=${provider.id} · model=${opts.model ?? config.provider.model ?? provider.defaultModel}`);
    io.out(`dataset ${datasetPath} (${cases.length}${opts.limit !== undefined && total > cases.length ? ` of ${total}, --limit` : ""} cases) · rubrics ${rubricsPath} (${rubrics.length})`);
    if (opts.show) io.out("--show is on: judged state (case content) is printed to stdout.");
    if (mode === "live") io.out("live mode sends input, output, policy, references and tool events for each case to TypeSafe.");
  }

  const labels: Record<string, string> = {};
  for (const entry of opts.label ?? []) {
    const idx = entry.indexOf("=");
    if (idx > 0) labels[entry.slice(0, idx)] = entry.slice(idx + 1);
  }

  const datasetOpts: Parameters<typeof evaluateDataset>[2] = {
    provider,
    concurrency: opts.concurrency ?? config.concurrency,
    timeoutMs: opts.timeoutMs ?? config.timeoutMs,
    maxAttempts: opts.maxAttempts ?? config.maxAttempts,
    datasetPath,
    labels,
    onCaseComplete: (result, index, total) => {
      if (opts.quiet && !opts.show) return;
      const statuses = result.checks.map((c) => `${c.rubricId}=${c.status}`).join(" ");
      io.out(`[${index + 1}/${total}] ${result.caseId}${result.error ? ` ERROR ${result.error.kind}` : ""} ${statuses}`);
      if (opts.show) {
        const evalCase = cases.find((c) => c.id === result.caseId);
        if (evalCase) {
          const { state } = buildJudgeState(evalCase, config.digest === undefined ? {} : { digest: config.digest });
          io.out(`  judged state: ${JSON.stringify(state)}`);
        }
        for (const check of result.checks) io.out(`  ${check.status.padEnd(7)} ${check.rubricId}: ${check.reason}`);
      }
    },
    onRetry: ({ caseId, attempt, delayMs, error }) => {
      const kind = error instanceof Error ? error.message : String(error);
      io.err(`retry ${caseId} attempt ${attempt} after ${delayMs} ms: ${kind}`);
    },
  };
  if (config.thresholds) datasetOpts.thresholds = config.thresholds;
  if (config.digest !== undefined) datasetOpts.digest = config.digest;
  if (opts.model ?? config.provider.model) datasetOpts.model = (opts.model ?? config.provider.model)!;
  if (config.pricing) datasetOpts.pricing = config.pricing;
  if (config.provenance !== undefined) datasetOpts.provenance = config.provenance;
  if (opts.signal) datasetOpts.signal = opts.signal;

  const report = await evaluateDataset(cases, rubrics, datasetOpts);

  const outPath = resolve(dir, opts.out ?? join(config.output, `run-${timestampSlug()}-${mode}.json`));
  writeFileSafe(outPath, JSON.stringify(report, null, 2));
  let htmlPath: string | undefined;
  if (opts.html) {
    htmlPath = outPath.replace(/\.json$/, "") + ".html";
    writeFileSafe(htmlPath, renderRunHtml(report));
  }

  const s = report.summary;
  io.out("");
  io.out(`${report.simulated ? "SIMULATED " : ""}summary: ${s.checkCount} checks · pass ${s.counts.pass} · fail ${s.counts.fail} · review ${s.counts.review} · skipped ${s.counts.skipped} · error ${s.counts.error}`);
  io.out(`pass rate (decided) ${fmtPct(s.passRateDecided)} · decided coverage ${fmtPct(s.decidedCoverage)} · review rate ${fmtPct(s.reviewRate)} · critical failures ${s.criticalFailures}`);
  io.out(`requests ${s.usage.requests} · input tokens ${s.usage.inputTokens} · cost ${s.usage.requests === 0 ? "n/a (no requests completed)" : report.cost ? `~$${report.cost.amount.toFixed(4)} (estimate)` : "unknown"}${report.simulated ? " · latency not measured (simulated)" : s.latencyMs.p50 !== null ? ` · latency p50 ${Math.round(s.latencyMs.p50)} ms` : ""}`);
  io.out(`report written to ${outPath}${htmlPath ? ` and ${htmlPath}` : ""}`);

  if (!opts.ci) return { exitCode: EXIT.ok, report, outPath };
  const gate = evaluateGates(report, config.ci);
  io.out("");
  if (gate.ok) io.out("CI gate: PASS");
  else {
    io.out(`CI gate: ${gate.exitCode === EXIT.gateFailed ? "FAIL (quality gate)" : "INCOMPLETE"} (exit ${gate.exitCode})`);
    for (const r of gate.reasons) io.out(`  - ${r}`);
  }
  return { exitCode: gate.exitCode, report, gate, outPath };
}

export async function reportCommand(runPath: string, opts: { out?: string; title?: string }, io: Io): Promise<{ exitCode: number; outPath: string }> {
  const abs = resolve(io.cwd, runPath);
  const report = loadRun(abs);
  const outPath = resolve(io.cwd, opts.out ?? abs.replace(/\.json$/, "") + ".html");
  const htmlOpts: { title?: string } = {};
  if (opts.title !== undefined) htmlOpts.title = opts.title;
  writeFileSafe(outPath, renderRunHtml(report, htmlOpts));
  io.out(`${report.simulated ? "SIMULATED " : ""}report written to ${outPath}`);
  return { exitCode: EXIT.ok, outPath };
}

export async function compareCommand(
  baselinePath: string,
  candidatePath: string,
  opts: { html?: string; json?: boolean; failOnNew?: boolean },
  io: Io,
): Promise<{ exitCode: number; comparison: Comparison }> {
  const baseline = loadRun(resolve(io.cwd, baselinePath));
  const candidate = loadRun(resolve(io.cwd, candidatePath));
  const comparison = compareRuns(baseline, candidate);
  if (opts.json) {
    io.out(JSON.stringify(comparison, null, 2));
  } else {
    io.out(`baseline ${comparison.baseline.runId.slice(0, 8)} (${comparison.baseline.mode}, ${comparison.baseline.model ?? "n/a"}) → candidate ${comparison.candidate.runId.slice(0, 8)} (${comparison.candidate.mode}, ${comparison.candidate.model ?? "n/a"})`);
    if (comparison.compatibility.issues.length) {
      io.out(comparison.compatibility.compatible ? "compatibility warnings:" : "NOT COMPARABLE:");
      for (const i of comparison.compatibility.issues) io.out(`  - [${i.severity}] ${i.message}`);
    }
    io.out(`shared cases ${comparison.alignment.sharedCases} · comparable rubrics ${comparison.alignment.sharedRubrics.length} · unchanged ${comparison.unchanged}`);
    const list = (title: string, rows: Comparison["newFailures"]) => {
      io.out(`${title}: ${rows.length}`);
      for (const r of rows) io.out(`  ${r.caseId} / ${r.rubricId}: ${r.before} → ${r.after}`);
    };
    list("new failures", comparison.newFailures);
    list("resolved failures", comparison.resolvedFailures);
    list("new reviews", comparison.newReviews);
    list("new errors", comparison.newErrors);
    list("other changes", comparison.otherChanges);
  }
  if (opts.html) {
    const outPath = resolve(io.cwd, opts.html);
    writeFileSafe(outPath, renderComparisonHtml(comparison));
    io.out(`comparison written to ${outPath}`);
  }
  let exitCode: number = EXIT.ok;
  if (!comparison.compatibility.compatible) exitCode = EXIT.incomplete;
  else if (opts.failOnNew && (comparison.newFailures.length > 0 || comparison.newErrors.length > 0)) exitCode = EXIT.gateFailed;
  return { exitCode, comparison };
}

export async function benchmarkCommand(
  runPath: string,
  opts: { labels: string; json?: boolean; out?: string; minCalibrationSamples?: number; targetAccuracy?: number },
  io: Io,
): Promise<{ exitCode: number; result: BenchmarkResult }> {
  const report = loadRun(resolve(io.cwd, runPath));
  const labels = loadLabels(resolve(io.cwd, opts.labels), (m) => io.err(`warning: ${m}`));
  if (labels.length === 0) throw new CliError("no valid labels found");
  const benchOpts: Parameters<typeof benchmarkRun>[2] = {};
  if (opts.minCalibrationSamples !== undefined) benchOpts.minCalibrationSamples = opts.minCalibrationSamples;
  if (opts.targetAccuracy !== undefined) benchOpts.targetAccuracy = opts.targetAccuracy;
  const result = benchmarkRun(report, labels, benchOpts);
  const payload = { generatedAt: new Date().toISOString(), run: { runId: report.runId, mode: report.mode, simulated: report.simulated, model: report.provider.model }, labelsPath: opts.labels, result };
  if (opts.out) {
    writeFileSafe(resolve(io.cwd, opts.out), JSON.stringify(payload, null, 2));
  }
  if (opts.json) {
    io.out(JSON.stringify(payload, null, 2));
    return { exitCode: EXIT.ok, result };
  }
  const f = result.failureDetection;
  io.out(`${result.simulated ? "SIMULATED " : ""}benchmark of run ${report.runId.slice(0, 8)} (${result.mode}, model ${result.model ?? "n/a"})`);
  io.out(`labels matched ${result.sampleCount} (binary ${result.binaryLabelCount}, undecidable ${result.undecidableLabelCount}) · unmatched labels ${result.labelsWithoutPrediction} · unlabelled predictions ${result.predictionsWithoutLabel}`);
  io.out(`label sources: ${Object.entries(result.labelSources).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);
  io.out(`failure detection (decided ${f.decided}): precision ${fmtPct(f.precision)} · recall ${fmtPct(f.recall)} · f1 ${fmtPct(f.f1)}`);
  io.out(`  confusion: TP ${f.confusion.truePositive} · FP ${f.confusion.falsePositive} · FN ${f.confusion.falseNegative} · TN ${f.confusion.trueNegative}`);
  io.out(`abstention on binary labels: review ${result.abstention.review} (${fmtPct(result.abstention.reviewRateOnBinary)}; on labelled fail ${result.abstention.reviewOnLabelledFail}, on labelled pass ${result.abstention.reviewOnLabelledPass}) · skipped ${result.abstention.skipped} · error ${result.abstention.error}`);
  io.out(`undecidable labels: agreement ${fmtPct(result.undecidable.agreementRate)} (${result.undecidable.agree}/${result.undecidableLabelCount}; decided anyway ${result.undecidable.predictedDecided})`);
  io.out(`execution errors ${result.executionErrors}`);
  io.out(`calibration: ${result.calibration.computed ? `ECE ${result.calibration.expectedCalibrationError?.toFixed(3)} over ${result.calibration.sample} samples` : `not computed (${result.calibration.reason})`}`);
  if (result.automation.sample > 0) {
    io.out(`automation curve (${result.automation.sample} labelled checks with scores): decide only when the leading side reaches the threshold`);
    io.out("  threshold  decided  accuracy  fail-precision  fail-recall");
    for (const p of result.automation.points) {
      if (p.decided === 0) continue;
      io.out(`  ${p.threshold.toFixed(2).padStart(9)}  ${fmtPct(p.decidedShare).padStart(7)}  ${fmtPct(p.accuracy).padStart(8)}  ${fmtPct(p.failPrecision).padStart(14)}  ${fmtPct(p.failRecall).padStart(11)}`);
    }
    const sg = result.automation.suggestion;
    if (sg) {
      io.out(sg.threshold !== null
        ? `  for ${fmtPct(sg.targetAccuracy)} accuracy: set thresholds.pass and thresholds.fail to ${sg.threshold.toFixed(2)} → decides ${fmtPct(sg.decidedShare)} of checks at ${fmtPct(sg.accuracy)}; the rest go to review`
        : `  ${sg.reason}`);
    }
  }
  io.out(`usage: ${result.usage.requests} requests · ${result.usage.inputTokens} input tokens · latency ${result.simulated ? "not measured (simulated)" : `p50 ${result.latencyMs.p50 ?? "n/a"} ms, p95 ${result.latencyMs.p95 ?? "n/a"} ms`}`);
  return { exitCode: EXIT.ok, result };
}

/** Helper for `jeval labels` — extract the expected labels embedded in a dataset into a separate JSONL file. */
export async function extractLabelsCommand(datasetPath: string, opts: { out: string }, io: Io): Promise<number> {
  const cases = loadDataset(resolve(io.cwd, datasetPath), (m) => io.err(`warning: ${m}`));
  const records = cases.flatMap((c) =>
    Object.entries(c.expected ?? {}).map(([rubricId, label]) => ({ caseId: c.id, rubricId, expected: label.status, source: label.source, ...(label.note ? { note: label.note } : {}) })),
  );
  writeFileSafe(resolve(io.cwd, opts.out), toJsonl(records));
  io.out(`wrote ${records.length} labels to ${opts.out}`);
  return EXIT.ok;
}

export function listRuns(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
}

export interface ReviewOptions {
  labels: string;
  reviewer?: string;
  /** Statuses to walk. Default: review. */
  statuses?: CheckStatus[];
  /** Test hook: scripted answers instead of a terminal. */
  answers?: string[];
  /** Optional dataset path to show the judged text beside each verdict. */
  dataset?: string;
}

/**
 * Walk a run's uncertain results and record human labels. Each decision is appended to a
 * labels JSONL as a LabelRecord with source "human", so `jeval benchmark` can use it.
 */
export async function reviewCommand(runPath: string, opts: ReviewOptions, io: Io): Promise<{ exitCode: number; written: number; skipped: number }> {
  const report = loadRun(resolve(io.cwd, runPath));
  const statuses = new Set<CheckStatus>(opts.statuses ?? ["review"]);
  const labelsPath = resolve(io.cwd, opts.labels);
  const existing = new Set<string>();
  if (existsSync(labelsPath)) {
    for (const l of loadLabels(labelsPath, () => {})) existing.add(`${l.caseId}\n${l.rubricId}`);
  }
  const cases = new Map<string, { input: string; output: string }>();
  if (opts.dataset) {
    for (const c of loadDataset(resolve(io.cwd, opts.dataset), (m) => io.err(`warning: ${m}`))) cases.set(c.id, { input: c.input, output: c.output });
  }
  const queue = report.cases.flatMap((c) => c.checks.filter((ch) => statuses.has(ch.status) && !existing.has(`${c.caseId}\n${ch.rubricId}`)));
  if (queue.length === 0) {
    io.out("nothing to review: no unlabelled checks with the requested statuses");
    return { exitCode: EXIT.ok, written: 0, skipped: 0 };
  }
  const reviewer = opts.reviewer ?? io.env.USER ?? io.env.USERNAME ?? "reviewer";
  const scripted = opts.answers ? [...opts.answers] : null;
  const rl = scripted ? null : createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (prompt: string): Promise<string> => {
    if (scripted) return scripted.shift() ?? "q";
    return new Promise((res) => rl!.question(prompt, (a) => res(a)));
  };
  const map: Record<string, LabelRecord["expected"]> = { p: "pass", f: "fail", r: "review", s: "skipped" };
  let written = 0;
  let skipped = 0;
  io.out(`${queue.length} check(s) to review · labels → ${labelsPath} · reviewer ${reviewer}`);
  io.out("keys: p=pass f=fail r=review (keep) s=skipped n=next (no label) q=quit");
  try {
    for (const [i, check] of queue.entries()) {
      io.out("");
      io.out(`[${i + 1}/${queue.length}] ${check.caseId} / ${check.rubricId} (${check.kind}, ${check.severity}) → ${check.status}`);
      io.out(`  reason: ${check.reason}`);
      if (check.rule) io.out(`  rule: ${check.rule}`);
      if (check.answers) {
        for (const [k, a] of Object.entries(check.answers)) {
          io.out(`  ${k}: ` + Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).map(([l, p]) => `${l} ${(p * 100).toFixed(0)}%`).join(" · "));
        }
      }
      for (const part of (check.parts ?? []).filter((p) => p.status !== "pass").slice(0, 6)) {
        io.out(`  ${part.status.padEnd(6)} ${part.id}: ${part.text.slice(0, 200)}${part.text.length > 200 ? "…" : ""}`);
      }
      const text = cases.get(check.caseId);
      if (text) {
        io.out(`  input:  ${text.input.slice(0, 400)}${text.input.length > 400 ? "…" : ""}`);
        io.out(`  output: ${text.output.slice(0, 600)}${text.output.length > 600 ? "…" : ""}`);
      }
      let key = (await ask("  label [p/f/r/s/n/q]: ")).trim().toLowerCase();
      while (!["p", "f", "r", "s", "n", "q"].includes(key)) key = (await ask("  please answer p, f, r, s, n or q: ")).trim().toLowerCase();
      if (key === "q") break;
      if (key === "n") {
        skipped += 1;
        continue;
      }
      const note = (await ask("  note (optional): ")).trim();
      const record: LabelRecord = { caseId: check.caseId, rubricId: check.rubricId, expected: map[key]!, source: "human", reviewer };
      if (note) record.note = note;
      appendFileSync(labelsPath, JSON.stringify(record) + "\n");
      written += 1;
    }
  } finally {
    rl?.close();
  }
  io.out("");
  io.out(`wrote ${written} human label(s) to ${labelsPath}${skipped ? ` · ${skipped} left unlabelled` : ""}`);
  return { exitCode: EXIT.ok, written, skipped };
}

/** Read existing labels file content (helper for tests). */
export function readLabelsFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export interface CaptureOptions {
  format?: ImportFormat | "auto";
  out: string;
  idPrefix?: string;
  /** Repeatable `field=dotted.path` pairs for the generic format. */
  map?: string[];
  policyFile?: string;
  metadataFields?: string[];
  toolStatusHeuristic?: boolean;
  /** Append to an existing dataset instead of refusing to overwrite. */
  append?: boolean;
}

/**
 * Convert exported traces or conversations (OpenAI chat, OpenTelemetry GenAI spans, Langfuse,
 * LangWatch, or a generic mapping) into a jeval dataset, so real traffic can be evaluated.
 */
export async function captureCommand(sourcePath: string, opts: CaptureOptions, io: Io): Promise<{ exitCode: number; imported: number; skipped: number }> {
  const abs = resolve(io.cwd, sourcePath);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    throw new CliError(`cannot read ${abs}: ${(e as Error).message}`);
  }
  let format: ImportFormat;
  if (!opts.format || opts.format === "auto") {
    let sample: unknown[] = [];
    try {
      const trimmed = text.trim();
      sample = trimmed.startsWith("[") ? (JSON.parse(trimmed) as unknown[]).slice(0, 20) : trimmed.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20).map((l) => JSON.parse(l));
    } catch {
      // detection below handles it
    }
    const detected = detectImportFormat(sample);
    if (!detected) throw new CliError("could not detect the trace format; pass --format chat|otel|langfuse|langwatch|generic");
    format = detected;
    io.out(`detected format: ${format}`);
  } else {
    format = opts.format;
  }
  const options: ImportOptions = { format };
  if (opts.idPrefix) options.idPrefix = opts.idPrefix;
  if (opts.toolStatusHeuristic === false) options.toolStatusHeuristic = false;
  if (opts.metadataFields && opts.metadataFields.length) options.metadataFields = opts.metadataFields;
  if (opts.policyFile) {
    try {
      options.policy = readFileSync(resolve(io.cwd, opts.policyFile), "utf8");
    } catch (e) {
      throw new CliError(`cannot read policy file: ${(e as Error).message}`);
    }
  }
  if (opts.map && opts.map.length) {
    const map: NonNullable<ImportOptions["map"]> = {};
    for (const entry of opts.map) {
      const idx = entry.indexOf("=");
      if (idx <= 0) throw new CliError(`--map expects field=path, got '${entry}'`);
      const key = entry.slice(0, idx) as keyof NonNullable<ImportOptions["map"]>;
      if (!["id", "input", "output", "messages", "policy", "context", "toolEvents", "metadata"].includes(key)) throw new CliError(`--map: unknown field '${key}'`);
      map[key] = entry.slice(idx + 1);
    }
    options.map = map;
  }
  const result = importJsonl(text, options);
  for (const issue of result.issues) io.err(`warning: record ${issue.index + 1}: ${issue.message}`);
  if (result.cases.length === 0) throw new CliError("no records could be converted into cases");
  const outPath = resolve(io.cwd, opts.out);
  const body = toJsonl(result.cases);
  if (opts.append && existsSync(outPath)) appendFileSync(outPath, body);
  else writeFileSafe(outPath, body, false);
  io.out(`captured ${result.stats.imported} case(s) from ${result.stats.records} record(s) (${result.stats.skipped} skipped, ${result.stats.withToolEvents} with tool events, ${result.stats.withMessages} with conversations) → ${outPath}`);
  io.out("next: jeval estimate --dataset " + opts.out + "  ·  jeval run --mode live --limit 5 --show --dataset " + opts.out);
  return { exitCode: EXIT.ok, imported: result.stats.imported, skipped: result.stats.skipped };
}
