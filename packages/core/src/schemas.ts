import { z } from "zod";
import type { JsonValue } from "./json.js";

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const idSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "ids may contain letters, digits, '.', '_', ':' and '-'");

export const MessageSchema = z.object({
  /** Stable id within the case. */
  id: idSchema,
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().max(200_000),
  /** Optional tool name for role=tool messages. */
  name: z.string().max(200).optional(),
  /** Links a tool message to the tool event it reports on. */
  toolEventId: idSchema.optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ToolEventSchema = z.object({
  /** Stable id within the case. */
  id: idSchema,
  /** Tool name as the agent invoked it. */
  name: z.string().min(1).max(200),
  /** Whether the tool reported success. Exact checks read this field, never the prose. */
  status: z.enum(["success", "failure"]),
  input: JsonValueSchema.optional(),
  output: JsonValueSchema.optional(),
  /** Error message reported by the tool, if any. */
  error: z.string().max(20_000).optional(),
});
export type ToolEvent = z.infer<typeof ToolEventSchema>;

export const ContextItemSchema = z.object({
  id: idSchema,
  title: z.string().max(500).optional(),
  content: z.string().min(1).max(200_000),
});
export type ContextItem = z.infer<typeof ContextItemSchema>;

export const CheckStatusSchema = z.enum(["pass", "fail", "review", "skipped", "error"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

/** Expected labels are harness data only and are never sent to the judge. */
export const ExpectedLabelSchema = z.object({
  status: CheckStatusSchema.exclude(["error"]),
  /** Where the label came from. Synthetic labels are provisional. */
  source: z.enum(["synthetic", "human", "imported"]).default("synthetic"),
  note: z.string().max(2000).optional(),
});
export type ExpectedLabel = z.infer<typeof ExpectedLabelSchema>;

export const EvalCaseSchema = z.object({
  /** Stable case id. Used to align runs in `compare` and labels in `benchmark`. */
  id: idSchema,
  /** The user input the assistant responded to. */
  input: z.string().max(200_000),
  /** The assistant output under evaluation. */
  output: z.string().max(200_000),
  /** Optional full conversation. When present it is shown to the judge alongside input/output. */
  messages: z.array(MessageSchema).max(500).optional(),
  /** Supplied reference material (retrieved passages, knowledge base entries, ground truth). */
  context: z.array(ContextItemSchema).max(200).optional(),
  /** Policy or instruction text the assistant was required to follow. */
  policy: z.string().max(100_000).optional(),
  /** Tool calls and their recorded results. */
  toolEvents: z.array(ToolEventSchema).max(500).optional(),
  /** Free-form metadata. Never sent to the judge. */
  metadata: z.record(z.string(), JsonValueSchema).optional(),
  /** Provisional expected outcomes keyed by rubric id. Never sent to the judge. */
  expected: z.record(z.string(), ExpectedLabelSchema).optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const ThresholdsSchema = z
  .object({
    /** Minimum probability of the acceptable outcome required to pass. */
    pass: z.number().min(0).max(1),
    /** Minimum probability of the unacceptable outcome required to fail. */
    fail: z.number().min(0).max(1),
  })
  .refine((t) => t.pass + t.fail > 1, {
    message: "thresholds.pass + thresholds.fail must exceed 1 so that no distribution can satisfy both",
  });
export type Thresholds = z.infer<typeof ThresholdsSchema>;

/**
 * Starting-point thresholds. They are not validated on your data; tune them with
 * `jeval benchmark` on a tuning split and confirm on a separate held-out split.
 */
export const DEFAULT_THRESHOLDS: Thresholds = { pass: 0.75, fail: 0.5 };

export const RubricKindSchema = z.enum([
  "policy-compliance",
  "claim-support",
  "tool-claim",
  "escalation",
  "custom",
]);
export type RubricKind = z.infer<typeof RubricKindSchema>;

export const SeveritySchema = z.enum(["critical", "major", "minor"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const EvidenceKindSchema = z.enum(["policy", "context", "toolEvents", "messages"]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

const outcomesSchema = z.object({
  acceptable: z.string().min(1).max(4000),
  unacceptable: z.string().min(1).max(4000),
  insufficient: z.string().min(1).max(4000),
});

export const RubricSchema = z.object({
  id: idSchema,
  version: z.string().min(1).max(50),
  description: z.string().min(1).max(4000),
  /** The question the judge answers, phrased as one specific criterion. */
  criterion: z.string().min(1).max(8000),
  kind: RubricKindSchema,
  severity: SeveritySchema.default("major"),
  /** Required checks feed CI gates. Optional checks are reported but do not gate. */
  required: z.boolean().default(true),
  applicability: z
    .object({
      /** Evidence that must be present. Missing evidence yields `review`, never `pass`. */
      requires: z.array(EvidenceKindSchema).default([]),
      /** Only run when the case's metadata matches every entry; otherwise `skipped`. */
      onlyWhenMetadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
    .default({ requires: [] }),
  thresholds: ThresholdsSchema.optional(),
  /** Descriptions the judge sees for each outcome of a semantic check. */
  outcomes: outcomesSchema.optional(),
  params: z
    .object({
      /** claim-support: the specific claim to check. Defaults to the response's factual claims. */
      claim: z.string().max(4000).optional(),
      /** claim-support: how to treat a claim the references do not cover. Default: review. */
      uncoveredIs: z.enum(["review", "fail"]).optional(),
      /** tool-claim / escalation: the tool name whose events establish the action. */
      toolName: z.string().max(200).optional(),
      /** tool-claim / escalation: plain-language description of the action, e.g. "booking the appointment". */
      action: z.string().max(1000).optional(),
      /** tool-claim: additional exact success condition on the tool output, e.g. { path: "status", equals: "confirmed" }. */
      successWhen: z.object({ path: z.string().min(1).max(200), equals: JsonValueSchema }).optional(),
    })
    .default({}),
});
export type Rubric = z.infer<typeof RubricSchema>;
export type RubricInput = z.input<typeof RubricSchema>;

export const LabelRecordSchema = z.object({
  caseId: idSchema,
  rubricId: idSchema,
  expected: CheckStatusSchema.exclude(["error"]),
  source: z.enum(["synthetic", "human", "imported"]).default("synthetic"),
  reviewer: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
});
export type LabelRecord = z.infer<typeof LabelRecordSchema>;

export function parseCase(value: unknown): EvalCase {
  return EvalCaseSchema.parse(value);
}

export function parseRubric(value: unknown): Rubric {
  const rubric = RubricSchema.parse(value);
  validateRubric(rubric);
  return rubric;
}

/** Kind-specific validation beyond the shape. */
export function validateRubric(rubric: Rubric): void {
  const need = (field: keyof Rubric["params"]): void => {
    if (rubric.params[field] === undefined) {
      throw new Error(`rubric ${rubric.id}: params.${field} is required for kind ${rubric.kind}`);
    }
  };
  switch (rubric.kind) {
    case "tool-claim":
      need("toolName");
      need("action");
      break;
    case "escalation":
      need("toolName");
      break;
    case "custom":
      if (!rubric.outcomes) {
        throw new Error(`rubric ${rubric.id}: outcomes (acceptable/unacceptable/insufficient) are required for kind custom`);
      }
      break;
    default:
      break;
  }
  if (rubric.thresholds) ThresholdsSchema.parse(rubric.thresholds);
}
