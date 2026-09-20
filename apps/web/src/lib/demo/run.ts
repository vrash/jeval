import { evaluateCase, FixtureProvider, type CaseResult, type JudgeProvider } from "@jeval/core";
import { DEMO_FIXTURES, DEMO_RUBRICS, type DemoPreset } from "./presets";

export interface DemoRunResult {
  mode: "simulated" | "live";
  result: CaseResult;
}

export async function runDemoPreset(
  preset: DemoPreset,
  rubricIds: readonly string[],
  provider?: JudgeProvider,
  signal?: AbortSignal,
): Promise<DemoRunResult> {
  const rubrics = DEMO_RUBRICS.filter((r) => rubricIds.includes(r.id));
  const judge = provider ?? new FixtureProvider({ fixtures: DEMO_FIXTURES, strict: true });
  const opts: Parameters<typeof evaluateCase>[2] = { provider: judge, maxAttempts: provider ? 2 : 1 };
  if (signal) opts.signal = signal;
  const result = await evaluateCase(preset.case, rubrics, opts);
  return { mode: judge.simulated ? "simulated" : "live", result };
}
