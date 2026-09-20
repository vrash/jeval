import { evaluateCase, FixtureProvider, builtinRubric } from "@jeval/core";
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
console.log(result.request?.simulated ? "simulated run" : `model ${result.request?.model}`, result.request?.usage);
