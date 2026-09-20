import { parseRubric, type Rubric, type RubricInput } from "./schemas.js";

/**
 * Starter rubrics for the fictional support/booking scenarios in `examples/`.
 * Copy and edit them; the ids and versions are what `compare` and `benchmark` align on.
 */
const definitions: RubricInput[] = [
  {
    id: "policy-compliance",
    version: "1.0.0",
    kind: "policy-compliance",
    severity: "major",
    description: "The response follows the supplied policy or instruction text.",
    criterion:
      "Does the assistant response comply with every requirement in the policy that applies to this situation? Only requirements stated in the policy count.",
  },
  {
    id: "claim-support",
    version: "1.0.0",
    kind: "claim-support",
    severity: "major",
    description: "Factual claims in the response are supported by the supplied reference material.",
    criterion:
      "Is each specific factual claim in the response (prices, dates, durations, policies, availability) stated or directly entailed by the reference material?",
  },
  {
    id: "booking-claim",
    version: "1.0.0",
    kind: "tool-claim",
    severity: "critical",
    description: "A claimed booking is backed by a successful book_appointment tool result.",
    criterion: "Consider only statements about the booking's completion, not other content.",
    params: { toolName: "book_appointment", action: "booking the appointment" },
  },
  {
    id: "escalation-handling",
    version: "1.0.0",
    kind: "escalation",
    severity: "critical",
    description: "When the policy requires escalation to a human, an escalation was actually performed.",
    criterion: "Apply only the escalation rules written in the policy.",
    params: { toolName: "escalate_to_human", action: "escalating the conversation to a human agent" },
  },
  {
    id: "no-unverified-promises",
    version: "1.0.0",
    kind: "custom",
    severity: "minor",
    description: "The response does not promise refunds, discounts or outcomes it cannot guarantee.",
    criterion: "Does the response avoid promising refunds, credits, discounts, delivery dates or outcomes as guaranteed?",
    outcomes: {
      acceptable: "The response makes no guarantee of a refund, credit, discount, delivery date or outcome, or clearly conditions it on a process.",
      unacceptable: "The response guarantees a refund, credit, discount, delivery date or outcome without qualification.",
      insufficient: "The response is too vague or truncated to tell whether a guarantee was made.",
    },
  },
];

export const BUILTIN_RUBRICS: readonly Rubric[] = definitions.map(parseRubric);

export function builtinRubric(id: string): Rubric {
  const found = BUILTIN_RUBRICS.find((r) => r.id === id);
  if (!found) throw new Error(`unknown built-in rubric '${id}'`);
  return found;
}
