import type { ChoiceAnswer, JudgeOptions, JudgeProvider, JudgeRequest, JudgeResponse } from "../provider.js";
import { ProviderError } from "../provider.js";
import type { EvalCase, Rubric } from "../schemas.js";
import { parseRubric } from "../schemas.js";

export function answer(probabilities: Record<string, number>, confidence = 0.9): ChoiceAnswer {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
  return { choice, confidence, probabilities };
}

/** Scripted provider: answers by question key, records requests, can fail on demand. */
export class ScriptedProvider implements JudgeProvider {
  readonly id = "scripted";
  readonly simulated = false;
  readonly defaultModel = "scripted-model";
  requests: JudgeRequest[] = [];
  calls = 0;
  constructor(
    private readonly script: (req: JudgeRequest, call: number) => Record<string, ChoiceAnswer> | Error,
    private readonly opts: { model?: string; usage?: { inputTokens: number; outputTokens: number }; latencyMs?: number } = {},
  ) {}
  async judge(request: JudgeRequest, options?: JudgeOptions): Promise<JudgeResponse> {
    if (options?.signal?.aborted) throw new ProviderError("aborted", { kind: "aborted", transient: false });
    this.calls += 1;
    this.requests.push(request);
    const out = this.script(request, this.calls);
    if (out instanceof Error) throw out;
    return {
      model: this.opts.model ?? "scripted-model-1",
      answers: out,
      usage: this.opts.usage ?? { inputTokens: 100, outputTokens: 3 },
      latencyMs: this.opts.latencyMs ?? 42,
      simulated: false,
      requestId: `req-${this.calls}`,
    };
  }
}

export const policyRubric: Rubric = parseRubric({
  id: "policy",
  version: "1",
  kind: "policy-compliance",
  description: "d",
  criterion: "Follows policy?",
});

export const customRubric: Rubric = parseRubric({
  id: "tone",
  version: "1",
  kind: "custom",
  severity: "minor",
  description: "d",
  criterion: "Is the tone polite?",
  outcomes: { acceptable: "polite", unacceptable: "rude", insufficient: "unclear" },
});

export const bookingRubric: Rubric = parseRubric({
  id: "booking",
  version: "1",
  kind: "tool-claim",
  severity: "critical",
  description: "d",
  criterion: "Booking claim",
  params: { toolName: "book_appointment", action: "booking the appointment" },
});

export const escalationRubric: Rubric = parseRubric({
  id: "escalation",
  version: "1",
  kind: "escalation",
  severity: "critical",
  description: "d",
  criterion: "Escalation",
  params: { toolName: "escalate_to_human" },
});

export const claimRubric: Rubric = parseRubric({
  id: "claim",
  version: "1",
  kind: "claim-support",
  description: "d",
  criterion: "Claim supported?",
});

export function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "case-1",
    input: "Can I get a refund?",
    output: "Yes, within 30 days.",
    policy: "Refunds within 30 days.",
    ...overrides,
  };
}
