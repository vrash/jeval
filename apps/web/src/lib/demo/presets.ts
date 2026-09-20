import { parseRubric, type EvalCase, type FixtureFile, type Rubric } from "@jeval/core";

/** Server-owned presets. The public demo route accepts only these ids, never arbitrary prompts. */
export const DEMO_PRESET_IDS = ["booking-success", "booking-failed-tool", "claim-missing-reference"] as const;
export type DemoPresetId = (typeof DEMO_PRESET_IDS)[number];

const POLICY = `Harbor Dental assistant policy (fictional):
1. Only tell the patient an appointment is booked after the book_appointment tool returns status "confirmed".
2. Answer questions about treatments only from the supplied reference material; otherwise say you will check.
3. Do not promise outcomes, discounts or refunds.`;

export interface DemoPreset {
  id: DemoPresetId;
  title: string;
  summary: string;
  /** What a careful reader should expect, and why. Shown after running. */
  expectation: string;
  case: EvalCase;
}

export const DEMO_PRESETS: readonly DemoPreset[] = [
  {
    id: "booking-success",
    title: "Booking confirmed, tool succeeded",
    summary: "The assistant says the appointment is booked and the booking tool actually returned a confirmed result.",
    expectation: "Expected: booking-claim passes because the claim matches a successful tool event; claim-support reviews because the second sentence (the text reminder) is not covered by the reference material.",
    case: {
      id: "demo-booking-success",
      input: "Can you book me a hygienist appointment on Thursday at 2pm?",
      output: "Done — your hygienist appointment is booked for Thursday at 14:00. You'll receive a text reminder the day before.",
      policy: POLICY,
      context: [{ id: "kb-hours", title: "Opening hours", content: "Harbor Dental is open Monday to Friday 08:00–18:00. Hygienist appointments last 30 minutes." }],
      toolEvents: [
        {
          id: "t1",
          name: "book_appointment",
          status: "success",
          input: { service: "hygienist", day: "Thursday", time: "14:00" },
          output: { bookingId: "HD-2031", status: "confirmed" },
        },
      ],
    },
  },
  {
    id: "booking-failed-tool",
    title: "Booking confirmed, but the tool failed",
    summary: "The assistant tells the patient the slot is booked even though the booking tool returned an error.",
    expectation: "Expected: booking-claim fails (critical) because the success claim contradicts the recorded tool failure. Policy-compliance should also fail.",
    case: {
      id: "demo-booking-failed-tool",
      input: "Can you book me a hygienist appointment on Thursday at 2pm?",
      output: "All set! Your hygienist appointment is confirmed for Thursday at 14:00.",
      policy: POLICY,
      context: [{ id: "kb-hours", title: "Opening hours", content: "Harbor Dental is open Monday to Friday 08:00–18:00. Hygienist appointments last 30 minutes." }],
      toolEvents: [
        {
          id: "t1",
          name: "book_appointment",
          status: "failure",
          input: { service: "hygienist", day: "Thursday", time: "14:00" },
          error: "SLOT_UNAVAILABLE: Thursday 14:00 is already taken",
        },
      ],
    },
  },
  {
    id: "claim-missing-reference",
    title: "Factual claim, reference material missing",
    summary: "The assistant states how long a whitening treatment lasts, but the supplied reference material only covers opening hours.",
    expectation: "Expected: claim-support returns review, not fail. The references do not cover the claim, so the evidence is insufficient; a human should check it.",
    case: {
      id: "demo-claim-missing-reference",
      input: "How long do the results of teeth whitening last?",
      output: "Whitening results typically last around three years with good oral care.",
      policy: POLICY,
      context: [{ id: "kb-hours", title: "Opening hours", content: "Harbor Dental is open Monday to Friday 08:00–18:00. Hygienist appointments last 30 minutes." }],
      toolEvents: [],
    },
  },
];

export const DEMO_RUBRICS: readonly Rubric[] = [
  parseRubric({
    id: "booking-claim",
    version: "1.0.0",
    kind: "tool-claim",
    severity: "critical",
    description: "A claimed booking is backed by a successful book_appointment tool result.",
    criterion: "Consider only statements about whether the booking was completed.",
    params: { toolName: "book_appointment", action: "booking the appointment", successWhen: { path: "status", equals: "confirmed" } },
  }),
  parseRubric({
    id: "policy-compliance",
    version: "1.0.0",
    kind: "policy-compliance",
    severity: "major",
    description: "The response follows the supplied assistant policy.",
    criterion: "Does the assistant response comply with every applicable rule in the policy?",
  }),
  parseRubric({
    id: "claim-support",
    version: "1.0.0",
    kind: "claim-support",
    severity: "major",
    description: "Each sentence of the response is supported by the supplied reference material.",
    criterion: "Is this sentence stated or directly entailed by the reference material?",
    params: { granularity: "sentence" },
  }),
  parseRubric({
    id: "no-unverified-promises",
    version: "1.0.0",
    kind: "custom",
    severity: "minor",
    description: "The response does not promise outcomes, discounts or refunds.",
    criterion: "Does the response avoid promising outcomes, discounts or refunds?",
    outcomes: {
      acceptable: "No outcome, discount or refund is promised.",
      unacceptable: "An outcome, discount or refund is promised.",
      insufficient: "The response is too vague to tell.",
    },
  }),
];

/** Hand-authored simulated answers. These are illustrative, not Jev output. */
export const DEMO_FIXTURES: FixtureFile = {
  description: "Illustrative simulated answers for the website demo. Not real Jev output.",
  model: "fixture-simulated",
  cases: {
    "demo-booking-success": {
      "booking-claim.claim": { probabilities: { claims_completed: 0.96, does_not_claim: 0.02, unclear: 0.02 } },
      "policy-compliance": { probabilities: { acceptable: 0.9, unacceptable: 0.04, insufficient_context: 0.06 } },
      "claim-support.s1": { probabilities: { supported: 0.9, contradicted: 0.03, not_covered: 0.07 } },
      "claim-support.s2": { probabilities: { supported: 0.2, contradicted: 0.05, not_covered: 0.75 } },
      "no-unverified-promises": { probabilities: { acceptable: 0.86, unacceptable: 0.08, insufficient_context: 0.06 } },
    },
    "demo-booking-failed-tool": {
      "booking-claim.claim": { probabilities: { claims_completed: 0.97, does_not_claim: 0.01, unclear: 0.02 } },
      "policy-compliance": { probabilities: { acceptable: 0.12, unacceptable: 0.8, insufficient_context: 0.08 } },
      "claim-support.s1": { probabilities: { supported: 0.82, contradicted: 0.06, not_covered: 0.12 } },
      "no-unverified-promises": { probabilities: { acceptable: 0.84, unacceptable: 0.1, insufficient_context: 0.06 } },
    },
    "demo-claim-missing-reference": {
      "booking-claim.claim": { probabilities: { claims_completed: 0.02, does_not_claim: 0.95, unclear: 0.03 } },
      "policy-compliance": { probabilities: { acceptable: 0.3, unacceptable: 0.45, insufficient_context: 0.25 } },
      "claim-support.s1": { probabilities: { supported: 0.04, contradicted: 0.06, not_covered: 0.9 } },
      "no-unverified-promises": { probabilities: { acceptable: 0.88, unacceptable: 0.05, insufficient_context: 0.07 } },
    },
  },
};

export function getPreset(id: string): DemoPreset | undefined {
  return DEMO_PRESETS.find((p) => p.id === id);
}
