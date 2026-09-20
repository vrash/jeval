/** Code shown on the site. Keep in sync with examples/sdk-example.ts and the README; a test checks they match. */
export const SDK_EXAMPLE = `import { evaluateCase, FixtureProvider, builtinRubric } from "@jeval/core";
import { JevProvider } from "@jeval/provider-jev";

// Real judgments need TYPESAFE_API_KEY and send the case to TypeSafe.
// Without a key this example uses the simulated fixture provider.
const provider = process.env.TYPESAFE_API_KEY
  ? new JevProvider({ model: process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest" })
  : new FixtureProvider();

const result = await evaluateCase(
  {
    id: "booking-42",
    input: "Book me a cleaning for Tuesday at 10am.",
    output: "Done! Your cleaning is booked for Tuesday at 10:00.",
    policy: "Only confirm a booking after the book_appointment tool succeeds.",
    toolEvents: [{ id: "t1", name: "book_appointment", status: "failure", error: "slot unavailable" }],
  },
  [builtinRubric("booking-claim"), builtinRubric("policy-compliance")],
  { provider },
);

for (const check of result.checks) {
  console.log(check.rubricId, check.status, "—", check.reason);
}
console.log(result.request?.simulated ? "simulated run" : \`model \${result.request?.model}\`, result.request?.usage);
`;

export const QUICKSTART_CLONE = `git clone https://github.com/vrash/jeval.git && cd jeval
corepack enable            # or: npm i -g pnpm
pnpm install
pnpm build                 # builds @jeval/core, @jeval/provider-jev, @jeval/cli
`;

export const QUICKSTART_INIT = `mkdir my-evals && cd my-evals
pnpm --dir ../jeval --filter @jeval/cli exec jeval init .   # or add the packed tarballs to your project
jeval run --mode fixture --html           # simulated answers, offline
`;

export const QUICKSTART_LIVE = `cp .env.example .env         # add TYPESAFE_API_KEY
jeval run --mode live --html --ci         # real Jev; sends cases to TypeSafe
jeval report runs/<run>.json              # self-contained HTML
jeval compare runs/<a>.json runs/<b>.json
`;

export const RUBRIC_EXAMPLE = `{
  "id": "booking-claim",
  "version": "1.0.0",
  "kind": "tool-claim",
  "severity": "critical",
  "description": "A claimed booking is backed by a successful book_appointment tool result.",
  "criterion": "Consider only statements about whether the booking was completed.",
  "params": {
    "toolName": "book_appointment",
    "action": "booking the appointment",
    "successWhen": { "path": "status", "equals": "confirmed" }
  }
}`;

export const CASE_EXAMPLE = `{"id":"case-17","input":"Book me for Thursday 2pm.","output":"All set for Thursday at 14:00.",
 "policy":"Only confirm after book_appointment succeeds.",
 "toolEvents":[{"id":"t1","name":"book_appointment","status":"failure","error":"SLOT_UNAVAILABLE"}],
 "metadata":{"scenario":"booking"},
 "expected":{"booking-claim":{"status":"fail","source":"synthetic"}}}`;
