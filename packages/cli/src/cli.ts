import { Command, InvalidArgumentError } from "commander";
import { EXIT } from "@jeval/core";
import { benchmarkCommand, captureCommand, compareCommand, estimateCommand, extractLabelsCommand, initCommand, reportCommand, reviewCommand, runCommand, type Io } from "./commands.js";
import { CliError } from "./io.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const io: Io = {
  out: (line) => process.stdout.write(line + "\n"),
  err: (line) => process.stderr.write(line + "\n"),
  cwd: process.cwd(),
  env: process.env,
};

function int(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new InvalidArgumentError("expected an integer");
  return n;
}

function finish(code: number): never {
  process.exitCode = code;
  process.exit(code);
}

async function guard(fn: () => Promise<number>): Promise<never> {
  try {
    finish(await fn());
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`error: ${error.message}`);
      finish(error.exitCode);
    }
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    finish(EXIT.usage);
  }
}

const program = new Command();
program
  .name("jeval")
  .description("Open-source evaluations for AI outputs and agents, judged by Jev.")
  .version(pkg.version)
  .addHelpText(
    "after",
    `
Exit codes (with --ci): 0 gates met · 1 quality gate failed · 2 run incomplete (errors, review, empty dataset, skipped required rubric, simulated run) · 3 usage or configuration error`,
  );

program
  .command("init")
  .argument("[dir]", "directory to initialise", ".")
  .description("create a starter config, rubrics, dataset and fixtures without overwriting existing files")
  .action((dir: string) => guard(() => initCommand(dir, io)));

program
  .command("run")
  .description("evaluate a dataset and write a JSON run report")
  .requiredOption("--mode <mode>", "fixture (simulated, offline) or live (real Jev; sends data to TypeSafe)", (v: string) => {
    if (v !== "fixture" && v !== "live") throw new InvalidArgumentError("mode must be 'fixture' or 'live'");
    return v;
  })
  .option("-c, --config <path>", "config file", "jeval.config.json")
  .option("--dataset <path>", "override dataset path")
  .option("--rubrics <path>", "override rubrics path")
  .option("-o, --out <path>", "run report path (default: <output>/run-<timestamp>-<mode>.json)")
  .option("--model <id>", "Jev model id for live mode (e.g. jev-latest, jev-1.13.0)")
  .option("--concurrency <n>", "parallel cases", int)
  .option("--timeout-ms <n>", "per-request timeout", int)
  .option("--max-attempts <n>", "attempts per request including the first", int)
  .option("--html", "also write an HTML report next to the JSON")
  .option("--ci", "apply the CI gate policy from the config and use the documented exit codes")
  .option("--label <key=value>", "attach a label to the run (repeatable)", (v: string, prev: string[] = []) => [...prev, v])
  .option("--limit <n>", "evaluate only the first N cases (sample before scale)", int)
  .option("--show", "print the judged state beside each verdict (exposes case content on stdout)")
  .option("--max-usd <amount>", "refuse to start a live run whose estimated cost exceeds this amount", (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError("expected a non-negative number");
    return n;
  })
  .option("-q, --quiet", "only print the summary")
  .action((opts) =>
    guard(async () => {
      const controller = new AbortController();
      const onSignal = () => {
        io.err("cancelling: finishing in-flight requests…");
        controller.abort();
      };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
      const result = await runCommand({ ...opts, signal: controller.signal }, io);
      return result.exitCode;
    }),
  );

program
  .command("capture")
  .argument("<traces>", "exported traces: JSONL or a JSON array")
  .description("convert exported traces (OpenAI chat, OpenTelemetry GenAI spans, Langfuse, LangWatch, generic) into a jeval dataset")
  .requiredOption("-o, --out <dataset.jsonl>", "dataset to write (refuses to overwrite unless --append)")
  .option("--format <name>", "chat | otel | langfuse | langwatch | generic | auto", "auto")
  .option("--id-prefix <prefix>", "prefix for generated case ids", "imported")
  .option("--map <field=path>", "generic format: dotted path for id, input, output, messages, policy, context, toolEvents, metadata (repeatable)", (v: string, prev: string[] = []) => [...prev, v])
  .option("--policy-file <path>", "attach this policy text to every case")
  .option("--metadata-fields <list>", "comma-separated source fields to copy into metadata", (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean))
  .option("--no-tool-status-heuristic", "do not infer tool failure from outputs; drop events without an explicit status")
  .option("--append", "append to an existing dataset")
  .action((traces: string, opts) => guard(async () => (await captureCommand(traces, opts, io)).exitCode));

program
  .command("estimate")
  .description("estimate judge requests, input tokens and cost for a dataset without sending anything")
  .option("-c, --config <path>", "config file", "jeval.config.json")
  .option("--dataset <path>", "override dataset path")
  .option("--rubrics <path>", "override rubrics path")
  .option("--limit <n>", "estimate only the first N cases", int)
  .option("--json", "print JSON")
  .action((opts) => guard(async () => (await estimateCommand(opts, io)).exitCode));

program
  .command("review")
  .argument("<run.json>")
  .description("walk uncertain results interactively and record human labels (JSONL, source=human)")
  .requiredOption("--labels <path>", "labels JSONL to append to")
  .option("--reviewer <name>", "reviewer name recorded on each label (default: $USER)")
  .option("--dataset <path>", "dataset JSONL, to show the judged input/output beside each verdict")
  .option("--statuses <list>", "comma-separated statuses to walk (default: review)", (v: string) => v.split(",").map((s) => s.trim()))
  .action((run: string, opts) => guard(async () => (await reviewCommand(run, opts, io)).exitCode));

program
  .command("report")
  .argument("<run.json>", "run report produced by `jeval run`")
  .description("render a run into a self-contained HTML report")
  .option("-o, --out <path>", "output path (default: next to the run)")
  .option("--title <title>", "report title")
  .action((run: string, opts) => guard(async () => (await reportCommand(run, opts, io)).exitCode));

program
  .command("compare")
  .argument("<baseline.json>")
  .argument("<candidate.json>")
  .description("compare two runs by case and rubric id; flags incompatible datasets, rubrics, models, thresholds and modes")
  .option("--html <path>", "write an HTML comparison")
  .option("--json", "print the comparison as JSON")
  .option("--fail-on-new", "exit 1 when there are new failures or errors")
  .action((a: string, b: string, opts) => guard(async () => (await compareCommand(a, b, opts, io)).exitCode));

program
  .command("benchmark")
  .argument("<run.json>")
  .description("score a run against separately supplied labels (JSONL of {caseId, rubricId, expected, source})")
  .requiredOption("--labels <path>", "labels JSONL")
  .option("--json", "print JSON")
  .option("-o, --out <path>", "write the benchmark JSON to a file")
  .option("--min-calibration-samples <n>", "minimum labelled probabilities before calibration is computed", int)
  .option("--target-accuracy <fraction>", "suggest the lowest decision threshold that reaches this accuracy on decided checks (e.g. 0.9)", (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 1) throw new InvalidArgumentError("expected a fraction between 0 and 1");
    return n;
  })
  .action((run: string, opts) => guard(async () => (await benchmarkCommand(run, opts, io)).exitCode));

program
  .command("labels")
  .argument("<dataset.jsonl>")
  .description("extract the provisional expected labels embedded in a dataset into a separate labels JSONL")
  .requiredOption("-o, --out <path>", "labels output path")
  .action((dataset: string, opts) => guard(() => extractLabelsCommand(dataset, opts, io)));

program.parseAsync(process.argv).catch((error: unknown) => {
  io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
  finish(EXIT.usage);
});
