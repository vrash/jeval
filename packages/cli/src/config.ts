import { z } from "zod";
import { GatePolicySchema, ThresholdsSchema } from "@jeval/core";

export const ConfigSchema = z.object({
  $schema: z.string().optional(),
  /** JSONL dataset path, relative to the config file. */
  dataset: z.string().default("./dataset.jsonl"),
  /** JSON file containing an array of rubrics, relative to the config file. */
  rubrics: z.string().default("./rubrics.json"),
  /** Directory for run reports. */
  output: z.string().default("./runs"),
  provider: z
    .object({
      /** Must be chosen explicitly: `fixture` (simulated) or `live` (real Jev). */
      mode: z.enum(["fixture", "live"]).optional(),
      /** Jev model id for live mode. */
      model: z.string().optional(),
      /** Fixture file for fixture mode. */
      fixtures: z.string().optional(),
      /** In fixture mode, fail on cases without a fixture instead of using deterministic fallbacks. */
      strictFixtures: z.boolean().default(false),
    })
    .default({ strictFixtures: false }),
  thresholds: ThresholdsSchema.optional(),
  /** Digest long states to fit the judge's input limit. `false` disables. Default 110k characters. */
  digest: z.union([z.literal(false), z.object({ maxChars: z.number().int().min(2000), headShare: z.number().min(0).max(1).optional() })]).optional(),
  concurrency: z.number().int().min(1).max(64).default(4),
  timeoutMs: z.number().int().min(1000).default(30_000),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  pricing: z
    .object({
      inputPerMillionTokensUsd: z.number().min(0),
      asOf: z.string(),
      source: z.string(),
    })
    .optional(),
  /** CI gate policy used by `jeval run --ci`. */
  ci: GatePolicySchema.partial().default({}),
  /** Free-form provenance note for the dataset, copied into reports. */
  provenance: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;
