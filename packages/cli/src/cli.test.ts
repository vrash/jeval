import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT } from "@jeval/core";
import { benchmarkCommand, captureCommand, compareCommand, estimateCommand, extractLabelsCommand, initCommand, reportCommand, reviewCommand, runCommand, type Io } from "./commands.js";
import type { CliError } from "./io.js";

function makeIo(cwd: string, env: NodeJS.ProcessEnv = {}): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { cwd, env, lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "jeval-cli-"));
}

describe("jeval CLI", () => {
  it("init creates starter files and never overwrites", async () => {
    const dir = scratch();
    const io = makeIo(dir);
    expect(await initCommand(undefined, io)).toBe(EXIT.ok);
    for (const f of ["jeval.config.json", "rubrics.json", "dataset.jsonl", "fixtures.json", ".env.example", "README.md"]) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
    writeFileSync(join(dir, "rubrics.json"), "[]");
    const io2 = makeIo(dir);
    await initCommand(undefined, io2);
    expect(readFileSync(join(dir, "rubrics.json"), "utf8")).toBe("[]");
    expect(io2.lines.some((l) => l.startsWith("kept existing"))).toBe(true);
  });

  it("run requires an explicit mode and rejects live mode without a key", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    await expect(runCommand({}, makeIo(dir))).rejects.toThrow(/choose a provider mode/);
    await expect(runCommand({ mode: "live" }, makeIo(dir, {}))).rejects.toThrow(/TYPESAFE_API_KEY/);
    try {
      await runCommand({ mode: "live" }, makeIo(dir, {}));
    } catch (e) {
      expect((e as CliError).exitCode).toBe(EXIT.usage);
    }
  });

  it("run (fixture) → report → compare → benchmark works end to end with documented exit codes", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    const io = makeIo(dir);
    const first = await runCommand({ mode: "fixture", out: "runs/a.json", html: true, ci: true }, io);
    expect(first.report?.simulated).toBe(true);
    expect(first.report?.summary.caseCount).toBe(4);
    expect(first.report?.summary.criticalFailures).toBe(1);
    // starter data contains a deliberate failure and a review, so the strict CI gate cannot pass
    expect(first.exitCode).toBe(EXIT.gateFailed);
    expect(io.lines.some((l) => l.includes("SIMULATED"))).toBe(true);
    expect(existsSync(join(dir, "runs/a.html"))).toBe(true);
    const html = readFileSync(join(dir, "runs/a.html"), "utf8");
    expect(html).toContain("Simulated results");
    // no API key or conversation content in stdout
    expect(io.lines.join("\n")).not.toContain("kettle");

    const rep = await reportCommand("runs/a.json", { out: "runs/a2.html" }, makeIo(dir));
    expect(rep.exitCode).toBe(EXIT.ok);

    const second = await runCommand({ mode: "fixture", out: "runs/b.json", quiet: true }, makeIo(dir));
    expect(second.exitCode).toBe(EXIT.ok);
    const cmpIo = makeIo(dir);
    const cmp = await compareCommand("runs/a.json", "runs/b.json", { html: "runs/cmp.html", failOnNew: true }, cmpIo);
    expect(cmp.exitCode).toBe(EXIT.ok);
    expect(cmp.comparison.newFailures).toHaveLength(0);
    expect(cmp.comparison.unchanged).toBeGreaterThan(0);

    expect(await extractLabelsCommand("dataset.jsonl", { out: "labels.jsonl" }, makeIo(dir))).toBe(EXIT.ok);
    const benchIo = makeIo(dir);
    const bench = await benchmarkCommand("runs/a.json", { labels: "labels.jsonl", out: "runs/bench.json" }, benchIo);
    expect(bench.exitCode).toBe(EXIT.ok);
    expect(bench.result.sampleCount).toBe(5);
    expect(bench.result.failureDetection.confusion.truePositive).toBe(1);
    expect(bench.result.calibration.computed).toBe(false);
    expect(benchIo.lines[0]).toContain("SIMULATED");
  });

  it("compare exits 2 for incompatible runs", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    await runCommand({ mode: "fixture", out: "runs/a.json", quiet: true }, makeIo(dir));
    const rubrics = JSON.parse(readFileSync(join(dir, "rubrics.json"), "utf8")) as Array<{ id: string; version: string }>;
    rubrics[0]!.version = "9.9.9";
    writeFileSync(join(dir, "rubrics.json"), JSON.stringify(rubrics));
    await runCommand({ mode: "fixture", out: "runs/b.json", quiet: true }, makeIo(dir));
    const cmp = await compareCommand("runs/a.json", "runs/b.json", {}, makeIo(dir));
    expect(cmp.exitCode).toBe(EXIT.incomplete);
    expect(cmp.comparison.compatibility.compatible).toBe(false);
  });

  it("ci gate on a clean dataset is incomplete for simulated runs unless allowed, and passes when allowed", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    const clean = readFileSync(join(dir, "dataset.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.includes("starter-refund-ok") || l.includes("starter-booking-ok"))
      .join("\n");
    writeFileSync(join(dir, "clean.jsonl"), clean + "\n");
    const strict = await runCommand({ mode: "fixture", dataset: "clean.jsonl", out: "runs/c.json", ci: true, quiet: true }, makeIo(dir));
    expect(strict.exitCode).toBe(EXIT.incomplete);
    expect(strict.gate?.reasons.join(" ")).toMatch(/simulated/);
    const cfg = JSON.parse(readFileSync(join(dir, "jeval.config.json"), "utf8"));
    cfg.ci = { allowSimulated: true, allowSkippedRequired: true };
    writeFileSync(join(dir, "jeval.config.json"), JSON.stringify(cfg));
    const relaxed = await runCommand({ mode: "fixture", dataset: "clean.jsonl", out: "runs/d.json", ci: true, quiet: true }, makeIo(dir));
    expect(relaxed.exitCode).toBe(EXIT.ok);
  });

  it("an empty dataset is reported and fails the CI gate as incomplete", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    writeFileSync(join(dir, "empty.jsonl"), "\n");
    const res = await runCommand({ mode: "fixture", dataset: "empty.jsonl", out: "runs/e.json", ci: true, quiet: true }, makeIo(dir));
    expect(res.report?.summary.caseCount).toBe(0);
    expect(res.exitCode).toBe(EXIT.incomplete);
    expect(res.gate?.reasons.join(" ")).toMatch(/empty/);
  });

  it("invalid dataset lines are warned about and the run continues", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    const original = readFileSync(join(dir, "dataset.jsonl"), "utf8");
    writeFileSync(join(dir, "dataset.jsonl"), "{broken\n" + original);
    const io = makeIo(dir);
    const res = await runCommand({ mode: "fixture", out: "runs/f.json", quiet: true }, io);
    expect(io.errors.some((e) => e.includes("invalid JSON"))).toBe(true);
    expect(res.report?.summary.caseCount).toBe(4);
  });
});

describe("estimate, sampling and review", () => {
  it("estimate sizes requests without sending anything and prices them from config", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    const io = makeIo(dir);
    const res = await estimateCommand({}, io);
    expect(res.estimate.caseCount).toBe(4);
    expect(res.estimate.requests).toBe(4);
    expect(res.estimate.cost?.estimated).toBe(true);
    expect(io.lines[0]).toMatch(/4 judge requests/);
    expect(io.lines.some((l) => l.includes("estimate at $0.042/M"))).toBe(true);
    const limited = await estimateCommand({ limit: 2 }, makeIo(dir));
    expect(limited.estimate.caseCount).toBe(2);
  });

  it("run --limit evaluates only the first cases and --show prints the judged state", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    const io = makeIo(dir);
    const res = await runCommand({ mode: "fixture", limit: 2, show: true, out: "runs/s.json" }, io);
    expect(res.report?.summary.caseCount).toBe(2);
    expect(io.lines.some((l) => l.includes("2 of 4, --limit"))).toBe(true);
    expect(io.lines.some((l) => l.startsWith("  judged state: ") && l.includes("assistant_response"))).toBe(true);
    const quiet = makeIo(dir);
    await runCommand({ mode: "fixture", limit: 1, quiet: true, out: "runs/q.json" }, quiet);
    expect(quiet.lines.some((l) => l.includes("kettle"))).toBe(false);
  });

  it("run --max-usd refuses a live run above the budget before sending anything", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    const io = makeIo(dir, { TYPESAFE_API_KEY: "test" });
    let calls = 0;
    const provider = { id: "spy", simulated: false, defaultModel: "m", judge: async () => { calls += 1; throw new Error("should not be called"); } };
    await expect(runCommand({ mode: "live", maxUsd: 0.0000001, provider, quiet: true }, io)).rejects.toThrow(/exceeds --max-usd/);
    expect(calls).toBe(0);
    expect(io.lines.some((l) => l.startsWith("pre-run estimate"))).toBe(true);
  });

  it("review walks uncertain checks with scripted answers and appends human labels", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    await runCommand({ mode: "fixture", out: "runs/r.json", quiet: true }, makeIo(dir));
    const io = makeIo(dir, { USER: "ana" });
    // the starter run has two review checks: first → next (unlabelled), second → fail with a note
    const res = await reviewCommand("runs/r.json", { labels: "human.jsonl", dataset: "dataset.jsonl", answers: ["n", "f", "tool log missing"] }, io);
    expect(res.written).toBe(1);
    expect(res.skipped).toBe(1);
    const lines = readFileSync(join(dir, "human.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ expected: "fail", source: "human", reviewer: "ana", note: "tool log missing" });
    expect(io.lines.some((l) => l.includes("output:"))).toBe(true);
    // second pass offers only the unlabelled one; quitting writes nothing
    const again = await reviewCommand("runs/r.json", { labels: "human.jsonl", answers: ["q"] }, makeIo(dir));
    expect(again.written).toBe(0);
    expect(again.skipped).toBe(0);
    // human labels feed the benchmark
    const bench = await benchmarkCommand("runs/r.json", { labels: "human.jsonl" }, makeIo(dir));
    expect(bench.result.labelSources).toEqual({ human: 1 });
  });
});

describe("capture", () => {
  it("converts OpenAI-style chat exports with tool calls into a dataset and chains into estimate/run", async () => {
    const dir = scratch();
    await initCommand(undefined, makeIo(dir));
    const records = [
      {
        id: "conv-1",
        messages: [
          { role: "system", content: "Only confirm after book_appointment succeeds." },
          { role: "user", content: "Book Tuesday 10am" },
          { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "book_appointment", arguments: '{"day":"Tuesday"}' } }] },
          { role: "tool", tool_call_id: "call_1", content: '{"error":"slot unavailable"}' },
          { role: "assistant", content: "Done, booked for Tuesday 10:00." },
        ],
      },
      { id: "conv-2", messages: [{ role: "user", content: "hi" }] },
    ];
    writeFileSync(join(dir, "traces.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const io = makeIo(dir);
    const res = await captureCommand("traces.jsonl", { out: "captured.jsonl", format: "auto" }, io);
    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(1);
    expect(io.lines[0]).toBe("detected format: chat");
    expect(io.errors.some((e) => e.includes("record 2"))).toBe(true);
    const line = JSON.parse(readFileSync(join(dir, "captured.jsonl"), "utf8").trim());
    expect(line.id).toBe("conv-1");
    expect(line.policy).toContain("book_appointment");
    expect(line.toolEvents[0]).toMatchObject({ name: "book_appointment", status: "failure" });
    expect(line.output).toBe("Done, booked for Tuesday 10:00.");
    const est = await estimateCommand({ dataset: "captured.jsonl" }, makeIo(dir));
    expect(est.estimate.requests).toBe(1);
    const run = await runCommand({ mode: "fixture", dataset: "captured.jsonl", out: "runs/c.json", quiet: true }, makeIo(dir));
    expect(run.report?.cases[0]?.checks.find((c) => c.rubricId === "booking-claim")?.status).toMatch(/fail|review/);
    await expect(captureCommand("traces.jsonl", { out: "captured.jsonl" }, makeIo(dir))).rejects.toThrow(/refusing to overwrite/);
  });

  it("supports the generic mapping", async () => {
    const dir = scratch();
    writeFileSync(join(dir, "rows.json"), JSON.stringify([{ ref: "r1", q: "Refund?", a: "Yes within 30 days.", rules: "Refunds within 30 days." }]));
    const res = await captureCommand("rows.json", { out: "d.jsonl", format: "generic", map: ["id=ref", "input=q", "output=a", "policy=rules"] }, makeIo(dir));
    expect(res.imported).toBe(1);
    const line = JSON.parse(readFileSync(join(dir, "d.jsonl"), "utf8").trim());
    expect(line).toMatchObject({ id: "r1", input: "Refund?", output: "Yes within 30 days.", policy: "Refunds within 30 days." });
  });
});
