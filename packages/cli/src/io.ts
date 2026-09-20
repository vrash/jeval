import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { EXIT, RubricSchema, parseCasesJsonl, parseLabelsJsonl, validateRubric, type EvalCase, type LabelRecord, type Rubric, type RunReport } from "@jeval/core";
import { ConfigSchema, type Config } from "./config.js";

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.usage,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function loadEnvFile(cwd: string): void {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return;
  const loader = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof loader === "function") {
    try {
      loader.call(process, path);
    } catch {
      // ignore malformed .env; the SDK will report a missing key
    }
  }
}

export function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new CliError(`cannot read ${path}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CliError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
}

export function loadConfig(path: string): { config: Config; dir: string; path: string } {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new CliError(`config not found: ${abs} (run \`jeval init\` to create one)`);
  const parsed = ConfigSchema.safeParse(readJson(abs));
  if (!parsed.success) throw new CliError(`invalid config ${abs}: ${formatZod(parsed.error)}`);
  return { config: parsed.data, dir: dirname(abs), path: abs };
}

export function loadRubrics(path: string): Rubric[] {
  const raw = readJson(path);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { rubrics?: unknown }).rubrics) ? (raw as { rubrics: unknown[] }).rubrics : null;
  if (!list) throw new CliError(`${path} must contain an array of rubrics (or { "rubrics": [...] })`);
  const rubrics: Rubric[] = [];
  list.forEach((entry, i) => {
    const parsed = RubricSchema.safeParse(entry);
    if (!parsed.success) throw new CliError(`rubric #${i + 1} in ${path} is invalid: ${formatZod(parsed.error)}`);
    try {
      validateRubric(parsed.data);
    } catch (e) {
      throw new CliError(`rubric #${i + 1} in ${path} is invalid: ${(e as Error).message}`);
    }
    rubrics.push(parsed.data);
  });
  if (rubrics.length === 0) throw new CliError(`${path} contains no rubrics`);
  return rubrics;
}

export function loadDataset(path: string, warn: (msg: string) => void): EvalCase[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new CliError(`cannot read dataset ${path}: ${(e as Error).message}`);
  }
  const { cases, issues } = parseCasesJsonl(text);
  for (const issue of issues) warn(`${path}:${issue.line}: ${issue.message}`);
  if (issues.length > 0 && cases.length === 0) throw new CliError(`no valid cases in ${path}`);
  return cases;
}

export function loadLabels(path: string, warn: (msg: string) => void): LabelRecord[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new CliError(`cannot read labels ${path}: ${(e as Error).message}`);
  }
  const { labels, issues } = parseLabelsJsonl(text);
  for (const issue of issues) warn(`${path}:${issue.line}: ${issue.message}`);
  return labels;
}

const RunReportShape = z.object({ schemaVersion: z.literal(1), runId: z.string(), cases: z.array(z.unknown()), summary: z.unknown(), rubrics: z.array(z.unknown()), mode: z.enum(["fixture", "live"]) });

export function loadRun(path: string): RunReport {
  const raw = readJson(path);
  const ok = RunReportShape.safeParse(raw);
  if (!ok.success) throw new CliError(`${path} is not a Jeval run report (schemaVersion 1): ${formatZod(ok.error)}`);
  return raw as RunReport;
}

export function writeFileSafe(path: string, content: string, overwrite = true): void {
  if (!overwrite && existsSync(path)) throw new CliError(`refusing to overwrite existing file ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function formatZod(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}
