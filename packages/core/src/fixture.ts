import { z } from "zod";
import { fingerprint } from "./json.js";
import type { ChoiceAnswer, JudgeOptions, JudgeProvider, JudgeRequest, JudgeResponse } from "./provider.js";
import { ProviderError } from "./provider.js";

/** Fixture answers: caseId -> questionKey -> probabilities (confidence is computed if omitted). */
export const FixtureFileSchema = z.object({
  /** Free-text provenance note, shown in reports. */
  description: z.string().optional(),
  model: z.string().default("fixture-simulated"),
  cases: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        probabilities: z.record(z.string(), z.number().min(0).max(1)),
        confidence: z.number().min(0).max(1).optional(),
      }),
    ),
  ),
});
export type FixtureFile = z.infer<typeof FixtureFileSchema>;

export interface FixtureProviderOptions {
  fixtures?: FixtureFile;
  /** When true, a missing fixture is an error instead of a deterministic fallback. */
  strict?: boolean;
  /** Simulated latency is reported as 0 so it is never mistaken for a measurement. */
  model?: string;
}

/** Confidence statistic used only for fixtures: 1 - normalised entropy. Labelled simulated. */
export function simulatedConfidence(probabilities: Record<string, number>): number {
  const values = Object.values(probabilities).filter((p) => p > 0);
  const n = Object.keys(probabilities).length;
  if (n <= 1) return 1;
  const entropy = -values.reduce((sum, p) => sum + p * Math.log(p), 0);
  return Math.max(0, Math.min(1, 1 - entropy / Math.log(n)));
}

function normalise(probabilities: Record<string, number>, options: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (const label of options) {
    const v = probabilities[label] ?? 0;
    out[label] = v;
    total += v;
  }
  if (total <= 0) throw new Error("fixture probabilities must not all be zero");
  for (const label of options) out[label] = out[label]! / total;
  return out;
}

function fallbackAnswer(seed: string, options: readonly string[]): Record<string, number> {
  // Deterministic, obviously artificial: weights derived from a hash, biased to the last option
  // (which is the insufficient/unclear outcome in every built-in rubric) so unknown cases lean to review.
  const h = fingerprint(seed);
  const raw = options.map((_, i) => 1 + parseInt(h.slice(i * 2, i * 2 + 2) || "0", 16) / 255);
  raw[raw.length - 1] = (raw[raw.length - 1] ?? 1) + 1.5;
  const total = raw.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  options.forEach((label, i) => (out[label] = raw[i]! / total));
  return out;
}

/**
 * Deterministic simulated judge for offline development and tests.
 * Every response is marked `simulated: true`. It never stands in for a failed real provider.
 */
export class FixtureProvider implements JudgeProvider {
  readonly id = "fixture";
  readonly simulated = true;
  readonly defaultModel: string;
  private readonly fixtures: FixtureFile | undefined;
  private readonly strict: boolean;

  constructor(options: FixtureProviderOptions = {}) {
    this.fixtures = options.fixtures ? FixtureFileSchema.parse(options.fixtures) : undefined;
    this.strict = options.strict ?? false;
    this.defaultModel = options.model ?? this.fixtures?.model ?? "fixture-simulated";
  }

  async judge(request: JudgeRequest, options?: JudgeOptions): Promise<JudgeResponse> {
    if (options?.signal?.aborted) throw new ProviderError("aborted", { kind: "aborted", transient: false });
    const caseId = request.meta?.caseId ?? "";
    const answers: Record<string, ChoiceAnswer> = {};
    const notes: string[] = [];
    for (const [key, question] of Object.entries(request.questions)) {
      const labels = Object.keys(question.options);
      const entry = this.fixtures?.cases[caseId]?.[key] ?? this.fixtures?.cases["*"]?.[key];
      let probabilities: Record<string, number>;
      if (entry) {
        probabilities = normalise(entry.probabilities, labels);
      } else if (this.strict) {
        throw new ProviderError(`no fixture for case '${caseId}' question '${key}'`, { kind: "bad_request", transient: false });
      } else {
        probabilities = fallbackAnswer(`${caseId}:${key}`, labels);
        notes.push(`fallback fixture used for question '${key}' (no fixture entry for case '${caseId}')`);
      }
      const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
      answers[key] = { choice, confidence: entry?.confidence ?? simulatedConfidence(probabilities), probabilities };
    }
    // Usage is an approximation of the serialised request size, labelled simulated via `simulated: true`.
    const inputTokens = Math.ceil(JSON.stringify({ state: request.state, questions: request.questions }).length / 4);
    const response: JudgeResponse = {
      model: request.model ?? this.defaultModel,
      answers,
      usage: { inputTokens, outputTokens: Object.keys(answers).length },
      latencyMs: 0,
      simulated: true,
    };
    if (notes.length) response.notes = notes;
    return response;
  }
}
