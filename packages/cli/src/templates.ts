import { BUILTIN_RUBRICS, toJsonl, type EvalCase, type FixtureFile } from "@jeval/core";
import type { ConfigInput } from "./config.js";

const POLICY = `Support policy (fictional):
1. Refunds are available within 30 days of purchase with a receipt.
2. Never promise a delivery date; say "estimated" and cite the carrier estimate.
3. If the customer reports a safety issue with a product, escalate to a human agent immediately using the escalate_to_human tool and tell the customer you have done so.
4. Do not offer discounts or credits.`;

export const STARTER_CASES: EvalCase[] = [
  {
    id: "starter-refund-ok",
    input: "I bought a kettle 10 days ago and it stopped working. Can I get a refund? I have the receipt.",
    output: "Yes. Because it's within 30 days and you have the receipt, you can return the kettle for a full refund. I'll send the return label to your email.",
    policy: POLICY,
    context: [{ id: "kb-returns", title: "Returns", content: "Refunds are available within 30 days of purchase with a receipt. Return labels are emailed within one business day." }],
    toolEvents: [],
    metadata: { scenario: "support", split: "starter" },
    expected: { "policy-compliance": { status: "pass", source: "synthetic" }, "claim-support": { status: "pass", source: "synthetic" } },
  },
  {
    id: "starter-booking-ok",
    input: "Book me a service appointment for Tuesday at 10am.",
    output: "Done. Your service appointment is booked for Tuesday at 10:00. You'll get a confirmation by SMS.",
    policy: POLICY,
    context: [{ id: "kb-booking", title: "Booking", content: "Service appointments can be booked Monday to Friday between 08:00 and 17:00. Confirmations are sent by SMS." }],
    toolEvents: [{ id: "t-book-1", name: "book_appointment", status: "success", input: { day: "Tuesday", time: "10:00" }, output: { bookingId: "B-1021", status: "confirmed" } }],
    metadata: { scenario: "booking", split: "starter" },
    expected: { "booking-claim": { status: "pass", source: "synthetic" } },
  },
  {
    id: "starter-booking-failed-tool",
    input: "Book me a service appointment for Tuesday at 10am.",
    output: "All set. Your appointment is confirmed for Tuesday at 10:00.",
    policy: POLICY,
    context: [{ id: "kb-booking", title: "Booking", content: "Service appointments can be booked Monday to Friday between 08:00 and 17:00. Confirmations are sent by SMS." }],
    toolEvents: [{ id: "t-book-2", name: "book_appointment", status: "failure", input: { day: "Tuesday", time: "10:00" }, error: "slot unavailable" }],
    metadata: { scenario: "booking", split: "starter" },
    expected: { "booking-claim": { status: "fail", source: "synthetic", note: "claims success despite tool failure" } },
  },
  {
    id: "starter-missing-reference",
    input: "How long is the warranty on the kettle?",
    output: "The kettle comes with a 5-year warranty.",
    policy: POLICY,
    context: [{ id: "kb-returns", title: "Returns", content: "Refunds are available within 30 days of purchase with a receipt." }],
    toolEvents: [],
    metadata: { scenario: "support", split: "starter" },
    expected: { "claim-support": { status: "review", source: "synthetic", note: "references do not cover the warranty" } },
  },
];

/** Fixture answers for the starter cases so `jeval run --mode fixture` produces sensible output offline. */
export const STARTER_FIXTURES: FixtureFile = {
  description: "Simulated answers for the starter dataset. Not real Jev output.",
  model: "fixture-simulated",
  cases: {
    "starter-refund-ok": {
      "policy-compliance": { probabilities: { acceptable: 0.9, unacceptable: 0.05, insufficient_context: 0.05 } },
      "claim-support": { probabilities: { supported: 0.92, contradicted: 0.03, not_covered: 0.05 } },
      "booking-claim.claim": { probabilities: { claims_completed: 0.02, does_not_claim: 0.95, unclear: 0.03 } },
      "escalation-handling.required": { probabilities: { required: 0.03, not_required: 0.94, insufficient_context: 0.03 } },
      "escalation-handling.stated": { probabilities: { states_escalation: 0.02, does_not_state: 0.95, unclear: 0.03 } },
      "no-unverified-promises": { probabilities: { acceptable: 0.85, unacceptable: 0.1, insufficient_context: 0.05 } },
    },
    "starter-booking-ok": {
      "policy-compliance": { probabilities: { acceptable: 0.88, unacceptable: 0.06, insufficient_context: 0.06 } },
      "claim-support": { probabilities: { supported: 0.9, contradicted: 0.04, not_covered: 0.06 } },
      "booking-claim.claim": { probabilities: { claims_completed: 0.96, does_not_claim: 0.02, unclear: 0.02 } },
      "escalation-handling.required": { probabilities: { required: 0.02, not_required: 0.95, insufficient_context: 0.03 } },
      "escalation-handling.stated": { probabilities: { states_escalation: 0.02, does_not_state: 0.95, unclear: 0.03 } },
      "no-unverified-promises": { probabilities: { acceptable: 0.8, unacceptable: 0.12, insufficient_context: 0.08 } },
    },
    "starter-booking-failed-tool": {
      "policy-compliance": { probabilities: { acceptable: 0.85, unacceptable: 0.08, insufficient_context: 0.07 } },
      "claim-support": { probabilities: { supported: 0.88, contradicted: 0.05, not_covered: 0.07 } },
      "booking-claim.claim": { probabilities: { claims_completed: 0.97, does_not_claim: 0.02, unclear: 0.01 } },
      "escalation-handling.required": { probabilities: { required: 0.02, not_required: 0.95, insufficient_context: 0.03 } },
      "escalation-handling.stated": { probabilities: { states_escalation: 0.02, does_not_state: 0.95, unclear: 0.03 } },
      "no-unverified-promises": { probabilities: { acceptable: 0.8, unacceptable: 0.12, insufficient_context: 0.08 } },
    },
    "starter-missing-reference": {
      "policy-compliance": { probabilities: { acceptable: 0.7, unacceptable: 0.1, insufficient_context: 0.2 } },
      "claim-support": { probabilities: { supported: 0.05, contradicted: 0.08, not_covered: 0.87 } },
      "booking-claim.claim": { probabilities: { claims_completed: 0.02, does_not_claim: 0.95, unclear: 0.03 } },
      "escalation-handling.required": { probabilities: { required: 0.02, not_required: 0.95, insufficient_context: 0.03 } },
      "escalation-handling.stated": { probabilities: { states_escalation: 0.02, does_not_state: 0.95, unclear: 0.03 } },
      "no-unverified-promises": { probabilities: { acceptable: 0.9, unacceptable: 0.05, insufficient_context: 0.05 } },
    },
  },
};

export const STARTER_CONFIG: ConfigInput = {
  dataset: "./dataset.jsonl",
  rubrics: "./rubrics.json",
  output: "./runs",
  provider: {
    model: "jev-latest",
    fixtures: "./fixtures.json",
  },
  thresholds: { pass: 0.75, fail: 0.5 },
  concurrency: 4,
  timeoutMs: 30000,
  maxAttempts: 3,
  pricing: {
    inputPerMillionTokensUsd: 0.042,
    asOf: "2026-09-19",
    source: "https://docs.typesafe.ai/models (documented input price on that date; verify before relying on it)",
  },
  ci: {},
  provenance: "Starter dataset generated by `jeval init`: synthetic cases with provisional labels, not human-reviewed.",
};

export function starterFiles(): Record<string, string> {
  return {
    "jeval.config.json": JSON.stringify(STARTER_CONFIG, null, 2) + "\n",
    "rubrics.json": JSON.stringify(BUILTIN_RUBRICS, null, 2) + "\n",
    "dataset.jsonl": toJsonl(STARTER_CASES),
    "fixtures.json": JSON.stringify(STARTER_FIXTURES, null, 2) + "\n",
    ".env.example":
      "# Required for `jeval run --mode live`. Never commit the real key.\nTYPESAFE_API_KEY=\n# Optional overrides\n# TYPESAFE_DEFAULT_MODEL=jev-latest\n# TYPESAFE_BASE_URL=https://api.typesafe.ai\n#\n# Alternative: route through Vercel AI Gateway (no TypeSafe account; billed by Vercel).\n# TYPESAFE_API_KEY=<AI Gateway API key or VERCEL_OIDC_TOKEN>\n# TYPESAFE_BASE_URL=https://ai-gateway.vercel.sh/typesafe\n# TYPESAFE_DEFAULT_MODEL=typesafe-ai/jev\n",
    "README.md": `# jeval project

- \`jeval run --mode fixture\` evaluates \`dataset.jsonl\` with simulated answers from \`fixtures.json\` (offline, clearly labelled simulated).
- \`jeval run --mode live\` sends the built judge state (input, output, policy, references, tool events) to TypeSafe's Jev. Requires TYPESAFE_API_KEY.
- \`jeval report runs/<run>.json\` renders a self-contained HTML report.
- \`jeval compare runs/<a>.json runs/<b>.json\` shows new and resolved failures.
- \`jeval benchmark runs/<run>.json --labels labels.jsonl\` scores the judge against separately supplied labels.

Expected labels inside \`dataset.jsonl\` are provisional and synthetic. They are never sent to the judge.
`,
  };
}
