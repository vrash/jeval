import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Demo } from "@/components/demo";
import { StatusBadge } from "@/components/status-badge";
import { WaitlistForm } from "@/components/waitlist-form";
import { SDK_EXAMPLE } from "@/lib/snippets";
import { REPO_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import { JsonLd } from "@/components/json-ld";
import { Pipeline } from "@/components/pipeline";
import { Terminal } from "@/components/terminal";

export default function HomePage() {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Node.js 20+",
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      license: "https://opensource.org/license/mit",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Open source. Provider usage billed separately by the provider." },
      ...(REPO_URL ? { codeRepository: REPO_URL } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: String(a) } })),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
    },
  ];
  return (
    <>
      <JsonLd data={structuredData} />
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-16 sm:px-6 sm:pt-24">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          Open source · bring your own TypeSafe key
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">Know when your AI gets it wrong.</h1>
        <p className="mt-6 max-w-2xl text-lg text-fg-muted sm:text-xl">
          Open-source evaluations for AI outputs and agents. Define your checks, run them with Jev, and inspect failures and uncertain results.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/docs/quickstart" className="rounded-md bg-fg px-5 py-2.5 text-sm font-medium text-bg hover:bg-accent">
            Get started
          </Link>
          <Link href="/cloud" className="rounded-md border border-line-strong px-5 py-2.5 text-sm font-medium hover:border-fg">
            Join the Cloud waitlist
          </Link>
          <Link href="/demo" className="px-2 py-2.5 text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-strong">
            Try the demo
          </Link>
        </div>
        <div className="mt-14">
          <Pipeline />
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-6xl px-4 sm:px-6" aria-labelledby="cycle">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-accent">One cycle, end to end</p>
            <h2 id="cycle" className="mt-2 text-2xl font-semibold tracking-tight">
              From last week&rsquo;s traffic to a release gate
            </h2>
            <p className="mt-3 text-fg-muted">
              Import the conversations your app already logged, see what a run will cost before it starts, judge a sample, label the uncertain
              ones yourself, then compare against yesterday&rsquo;s run. A failure that appears on a stable case id blocks the release; a{" "}
              <StatusBadge status="review" size="sm" /> never counts as a pass.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-fg-muted">
              <li>Bring your own TypeSafe key, or route through Vercel AI Gateway with no TypeSafe account.</li>
              <li>Every judgment keeps its probabilities, the rule applied in code and the evidence it saw.</li>
              <li>Nothing is sent anywhere until you choose live mode; fixture mode runs offline and says so.</li>
            </ul>
          </div>
          <Terminal />
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="can">
        <h2 id="can" className="text-2xl font-semibold tracking-tight">
          What you can do today
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <div key={c.title} className="rise flex flex-col rounded-xl border border-line bg-bg-elevated p-5" style={{ ["--i" as string]: i }}>
              <h3 className="font-semibold">{c.title}</h3>
              <p className="mt-2 flex-1 text-sm text-fg-muted">{c.body}</p>
              <code className="mt-4 block overflow-x-auto whitespace-nowrap rounded-md border border-line bg-bg-code px-2.5 py-1.5 font-mono text-xs">{c.code}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6" aria-labelledby="how">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
          <div>
            <h2 id="how" className="text-2xl font-semibold tracking-tight">
              Small checks, structured answers
            </h2>
            <p className="mt-3 text-fg-muted">
              Every rubric asks Jev one narrow multiple-choice question about the state you supply: acceptable, unacceptable, or not enough evidence.
              jeval turns the returned probabilities into <StatusBadge status="pass" size="sm" />, <StatusBadge status="fail" size="sm" /> or{" "}
              <StatusBadge status="review" size="sm" /> using thresholds you control, and composes them with exact checks in code, such as whether the
              booking tool actually returned <code className="font-mono text-sm">confirmed</code>.
            </p>
            <ul className="mt-5 space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="mt-0.5 font-mono text-accent">01</span>
                <span>
                  <b>Define</b> cases from your app&rsquo;s inputs, outputs, tool events and references, plus rubrics as JSON or code.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 font-mono text-accent">02</span>
                <span>
                  <b>Run</b> one case after a response is generated, or a JSONL dataset with bounded concurrency, retries and a CI gate.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 font-mono text-accent">03</span>
                <span>
                  <b>Review</b> failures and uncertain results in a local HTML report, and compare runs to catch regressions.
                </span>
              </li>
            </ul>
          </div>
          <CodeBlock code={SDK_EXAMPLE} lang="ts" title="examples/sdk-example.ts" />
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="try">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 id="try" className="text-2xl font-semibold tracking-tight">
            See a check decide
          </h2>
          <Link href="/demo" className="text-sm font-medium text-accent underline underline-offset-4">
            Open the full demo
          </Link>
        </div>
        <Demo compact />
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="uses">
        <h2 id="uses" className="text-2xl font-semibold tracking-tight">
          Built for the failures that matter
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Support assistants", "Did the reply follow the refund policy? Did it promise something the policy forbids?"],
            ["Booking and action agents", "Did the assistant confirm an action that the tool log says failed, or never ran?"],
            ["Retrieval applications", "Is the stated price, date or duration actually in the retrieved passages, or unsupported?"],
            ["Escalation rules", "When the policy required a hand-off to a human, was the escalation tool actually called?"],
          ].map(([title, body]) => (
            <div key={title} className="rounded-xl border border-line bg-bg-elevated p-5">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-fg-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="paths">
        <h2 id="paths" className="text-2xl font-semibold tracking-tight">
          Two ways to use jeval
        </h2>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-fg p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Available now</p>
            <h3 className="mt-1 text-xl font-semibold">jeval open source</h3>
            <p className="mt-2 text-fg-muted">MIT licensed. No jeval account. Bring your own TypeSafe API key; runs and reports stay on your machine.</p>
            <ul className="mt-4 space-y-2 text-sm">
              {["TypeScript SDK for single cases and datasets", "CLI: init, run, report, compare, benchmark", "Five starter rubric kinds plus custom criteria", "Local HTML reports and CI exit codes", "Deterministic fixture mode for offline tests"].map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="text-pass" aria-hidden="true">✓</span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/docs/quickstart" className="rounded-md bg-fg px-4 py-2 text-sm font-medium text-bg hover:bg-accent">
                Quickstart
              </Link>
              {REPO_URL ? (
                <a href={REPO_URL} rel="noopener" className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium">
                  Source on GitHub
                </a>
              ) : null}
            </div>
          </div>
          <div className="rounded-xl border border-dashed border-line-strong p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-accent">Planned · waitlist</p>
            <h3 className="mt-1 text-xl font-semibold">jeval Cloud</h3>
            <p className="mt-2 text-fg-muted">A managed service we are designing. None of this exists yet; the waitlist tells us what to build first.</p>
            <ul className="mt-4 space-y-2 text-sm text-fg-muted">
              {["Managed runs without your own provider key", "Saved history and run-over-run comparisons", "Shared dashboards for a team", "Alerts on new failures", "Review queues for uncertain results"].map((t) => (
                <li key={t} className="flex gap-2">
                  <span aria-hidden="true">○</span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-5">
              <Link href="/cloud" className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium hover:border-fg">
                Join the waitlist
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="recorded">
        <div className="rounded-xl border border-line p-6 sm:p-8">
          <p className="text-xs font-medium uppercase tracking-wide text-accent">One recorded run on human-labelled public data</p>
          <h2 id="recorded" className="mt-2 text-2xl font-semibold tracking-tight">
            What Jev did on 300 RAGTruth responses
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            {[
              ["88.3% / 98.1%", "failure-detection precision / recall on the 205 cases it decided, sentence by sentence (TP 106, FP 14, FN 2, TN 83)"],
              ["32%", "abstained as review rather than guessed; a 0.60 threshold decides 96% of sentences at 90% accuracy"],
              ["992k tokens", "input for 300 cases, about $0.04 at the documented rate, zero execution errors"],
              ["363 ms", "median request latency, one run"],
            ].map(([n, d]) => (
              <div key={n}>
                <p className="text-2xl font-semibold tabular-nums">{n}</p>
                <p className="mt-1 text-sm text-fg-muted">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-fg-muted">
            RAGTruth&rsquo;s own human span-level labels, balanced across QA, summarisation and data-to-text, rubric wording and thresholds fixed on a
            separate tuning split first. One run, one day; it still over-flags some data-to-text paraphrase, and it says nothing about your data. Per-task tables and the reproduction script are in the repository&rsquo;s{" "}
            <code className="font-mono text-xs">examples/public-benchmarks</code>. <Link href="/docs/benchmark" className="text-accent underline underline-offset-4">How to measure it on yours</Link>.
          </p>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-3xl px-4 sm:px-6" aria-labelledby="faq">
        <h2 id="faq" className="text-2xl font-semibold tracking-tight">
          Questions
        </h2>
        <dl className="mt-6 divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <div key={q} className="py-4">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1.5 text-sm text-fg-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mx-auto mt-20 max-w-3xl px-4 sm:px-6" aria-labelledby="waitlist" id="waitlist">
        <h2 id="waitlist" className="text-2xl font-semibold tracking-tight">
          jeval Cloud waitlist
        </h2>
        <p className="mt-2 text-fg-muted">Managed runs, saved history and team dashboards are planned. Leave your email to hear about early access.</p>
        <div className="mt-6 rounded-xl border border-line bg-bg-elevated p-5">
          <WaitlistForm source="site" />
        </div>
      </section>
    </>
  );
}

const CAPABILITIES: Array<{ title: string; body: string; code: string }> = [
  {
    title: "Evaluate what you already log",
    body: "Import OpenAI-style chat transcripts, OpenTelemetry GenAI spans, Langfuse or LangWatch exports, or map any JSON. Tool calls become tool events.",
    code: "jeval capture traces.jsonl -o dataset.jsonl",
  },
  {
    title: "Five checks that compose with code",
    body: "Policy compliance, claim support against references, tool-backed action claims, required escalations, and custom criteria. Exact conditions are checked in code, the judge answers one narrow question.",
    code: '{ "kind": "tool-claim", "params": { "toolName": "book_appointment" } }',
  },
  {
    title: "Know the cost before you run",
    body: "Estimate requests, input tokens and price from the exact state a run would send. Refuse to start above a budget. Sample five cases with the judged state beside each verdict.",
    code: "jeval run --mode live --limit 5 --show --max-usd 0.50",
  },
  {
    title: "Review, not guess",
    body: "Missing evidence, flat probabilities and uncovered claims come back as review. Walk them interactively and record human labels that the benchmark reports by source.",
    code: "jeval review runs/live.json --labels human.jsonl",
  },
  {
    title: "Regressions by stable id",
    body: "Compare two runs case by case and rubric by rubric: new failures, resolved failures, new reviews. Different datasets, rubric versions, models or modes are flagged, never silently merged.",
    code: "jeval compare runs/a.json runs/b.json --fail-on-new",
  },
  {
    title: "Gates you can trust in CI",
    body: "Exit 0 only when the configured gates are met and every required check reached a decision. Review, errors, an empty dataset or a simulated run cannot yield a clean pass.",
    code: "jeval run --mode live --ci   # 0 ok · 1 gate failed · 2 incomplete",
  },
];

const FAQ: Array<[string, React.ReactNode]> = [
  [
    "Is jeval free?",
    "The framework is MIT-licensed and free. Real evaluations call TypeSafe's Jev with your own API key, and TypeSafe may bill that usage. jeval estimates cost from a rate you configure and labels it as an estimate.",
  ],
  ["Do I need a jeval account?", "No. The open-source SDK and CLI work from a clone with your own provider key. jeval Cloud is a planned managed service and is not available yet."],
  ["What do I need for real runs?", "A TypeSafe API key. Without one you can still run everything in fixture mode, which uses deterministic simulated answers and is labelled as such everywhere."],
  [
    "What does 'review' mean?",
    "The judge's probabilities did not reach your pass or fail threshold, or the evidence needed for the check was missing. Review results need a person; they never count as passes, and a strict CI run treats them as incomplete.",
  ],
  [
    "Does running locally keep my data local?",
    "Reports and datasets stay on your machine, but a live run sends the selected fields of each case (input, output, policy, references, tool events) to TypeSafe. Expected labels and metadata are never sent. Fixture mode sends nothing.",
  ],
  ["Is jeval made by TypeSafe?", "No. jeval is an independent open-source project that uses TypeSafe's Jev as its first judge provider. It is not affiliated with or endorsed by TypeSafe."],
  ["Is the judge immune to prompt injection?", "No. Evaluated text is marked as untrusted in every question, and the examples include adversarial cases, but this is a mitigation with observed limits, not immunity. See the limitations page."],
];
