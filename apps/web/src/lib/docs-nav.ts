export const DOC_PAGES = [
  { slug: "quickstart", title: "Quickstart", description: "Install from a clone, run a simulated evaluation, then a real one with your TypeSafe key." },
  { slug: "cases", title: "Evaluation cases", description: "The case schema: input, output, messages, references, policy, tool events, metadata and expected labels." },
  { slug: "rubrics", title: "Rubrics", description: "The five check kinds, how deterministic rules compose with Jev questions, thresholds and statuses." },
  { slug: "cli", title: "CLI", description: "jeval init, run, report, compare, benchmark and labels." },
  { slug: "ci", title: "Reports and CI gates", description: "Pass-rate denominators, decided coverage, exit codes and how to loosen the policy deliberately." },
  { slug: "jev", title: "Jev integration", description: "What is sent to TypeSafe, models, usage and cost, probabilities versus confidence." },
  { slug: "benchmark", title: "Benchmarking the judge", description: "Score predicted outcomes against labels; tuning versus held-out splits; calibration." },
  { slug: "limitations", title: "Limitations", description: "Prompt injection, literal judging, synthetic labels, unverified integrations." },
] as const;

export type DocSlug = (typeof DOC_PAGES)[number]["slug"];
