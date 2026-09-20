const STEPS = [
  { cmd: "capture", label: "Import real traces", note: "OpenAI chat, OTel, Langfuse, LangWatch" },
  { cmd: "estimate", label: "Price it first", note: "tokens and cost before anything is sent" },
  { cmd: "run", label: "Judge every case", note: "one Jev request per case, all checks batched" },
  { cmd: "review", label: "Decide the uncertain", note: "human labels, not guesses" },
  { cmd: "compare", label: "Catch regressions", note: "new and resolved failures by case id" },
  { cmd: "run --ci", label: "Gate the release", note: "exit 0 only when the gates are met" },
];

/** CSS-animated workflow grid. No JavaScript; reduced-motion users get the static version. */
export function Pipeline() {
  return (
    <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="jeval workflow">
      {STEPS.map((s, i) => (
        <li key={s.cmd} className="pipeline-step flex flex-col rounded-lg border border-line bg-bg-elevated px-3 py-2.5" style={{ ["--i" as string]: i }}>
          <span className="flex items-center justify-between font-mono text-xs">
            <span className="text-accent">jeval {s.cmd}</span>
            <span className="text-fg-faint">{String(i + 1).padStart(2, "0")}</span>
          </span>
          <span className="mt-1 text-sm font-medium">{s.label}</span>
          <span className="mt-0.5 text-xs text-fg-muted">{s.note}</span>
        </li>
      ))}
    </ol>
  );
}
