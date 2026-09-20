const STEPS = [
  { cmd: "capture", label: "Import real traces", note: "OpenAI chat, OTel, Langfuse, LangWatch" },
  { cmd: "estimate", label: "Price it first", note: "tokens and cost before anything is sent" },
  { cmd: "run", label: "Judge every case", note: "one Jev request per case, all checks batched" },
  { cmd: "review", label: "Decide the uncertain", note: "human labels, not guesses" },
  { cmd: "compare", label: "Catch regressions", note: "new and resolved failures by case id" },
  { cmd: "run --ci", label: "Gate the release", note: "exit 0 only when the gates are met" },
];

/** Static, CSS-animated workflow strip. No JavaScript; reduced-motion users get the static version. */
export function Pipeline() {
  return (
    <ol className="flex flex-wrap items-stretch gap-y-4" aria-label="jeval workflow">
      {STEPS.map((s, i) => (
        <li key={s.cmd} className="flex items-center">
          <div
            className="pipeline-step flex min-w-[10.5rem] flex-col rounded-lg border border-line bg-bg-elevated px-3 py-2.5"
            style={{ ["--i" as string]: i }}
          >
            <span className="font-mono text-xs text-accent">jeval {s.cmd}</span>
            <span className="mt-0.5 text-sm font-medium">{s.label}</span>
            <span className="text-xs text-fg-muted">{s.note}</span>
          </div>
          {i < STEPS.length - 1 ? <span aria-hidden="true" className="pipeline-link mx-1 hidden h-0.5 w-6 sm:block" /> : null}
        </li>
      ))}
    </ol>
  );
}
