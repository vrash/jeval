"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { CaseResult, CheckResult } from "@jeval/core";
import { DEMO_PRESETS, DEMO_RUBRICS, type DemoPresetId } from "@/lib/demo/presets";
import { runDemoPreset } from "@/lib/demo/run";
import { StatusBadge } from "@/components/status-badge";

type Mode = "simulated" | "live";

interface LiveStatus {
  live: boolean;
  model: string | null;
}

export function Demo({ compact = false }: { compact?: boolean }) {
  const [presetId, setPresetId] = useState<DemoPresetId>("booking-failed-tool");
  const [selected, setSelected] = useState<string[]>(DEMO_RUBRICS.map((r) => r.id));
  const [mode, setMode] = useState<Mode>("simulated");
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({ live: false, model: null });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ mode: Mode; result: CaseResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(!compact);
  const headingId = useId();
  const preset = useMemo(() => DEMO_PRESETS.find((p) => p.id === presetId)!, [presetId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/demo", { method: "GET" })
      .then((r) => (r.ok ? r.json() : { live: false, model: null }))
      .then((s: LiveStatus) => {
        if (!cancelled) setLiveStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      if (mode === "live") {
        const res = await fetch("/api/demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ presetId, rubricIds: selected }),
        });
        const body = (await res.json()) as { ok: boolean; result?: CaseResult; message?: string; error?: string };
        if (!res.ok || !body.ok || !body.result) {
          setError(body.message ?? `Live evaluation failed (${body.error ?? res.status}).`);
        } else {
          setResult({ mode: "live", result: body.result });
        }
      } else {
        const out = await runDemoPreset(preset, selected);
        setResult({ mode: "simulated", result: out.result });
      }
    } catch (e) {
      setError(e instanceof Error ? `Could not run the example: ${e.message}` : "Could not run the example.");
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
  }

  function choosePreset(id: DemoPresetId) {
    setPresetId(id);
    reset();
  }

  function chooseMode(next: Mode) {
    setMode(next);
    reset();
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    reset();
  }

  const c = preset.case;

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-line bg-bg-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h2 id={headingId} className="text-base font-semibold">
          Interactive example
        </h2>
        <p className="rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-xs font-medium text-accent-strong" role="status">
          {mode === "live" ? "Live mode: real Jev judgments" : "Illustrative demo: simulated results"}
        </p>
      </div>

      <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <fieldset>
            <legend className="text-sm font-medium">1. Pick a scenario</legend>
            <div className="mt-2 space-y-2">
              {DEMO_PRESETS.map((p) => (
                <label key={p.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${p.id === presetId ? "border-fg" : "border-line hover:border-line-strong"}`}>
                  <input type="radio" name="preset" value={p.id} checked={p.id === presetId} onChange={() => choosePreset(p.id)} className="mt-1 accent-accent" />
                  <span>
                    <span className="block text-sm font-medium">{p.title}</span>
                    <span className="block text-sm text-fg-muted">{p.summary}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <button
              type="button"
              className="text-sm font-medium text-accent underline underline-offset-4"
              aria-expanded={showInput}
              onClick={() => setShowInput((v) => !v)}
            >
              {showInput ? "Hide" : "Inspect"} the evaluated case
            </button>
            {showInput ? (
              <dl className="mt-3 space-y-3 text-sm">
                <Row label="User input">{c.input}</Row>
                <Row label="Assistant output">{c.output}</Row>
                <Row label="Policy">
                  <pre className="whitespace-pre-wrap font-sans">{c.policy}</pre>
                </Row>
                <Row label="Reference material">
                  {c.context?.length ? c.context.map((x) => <p key={x.id}><span className="font-mono text-xs text-fg-faint">{x.id}</span> {x.content}</p>) : <em>none supplied</em>}
                </Row>
                <Row label="Tool events">
                  {c.toolEvents?.length ? (
                    <ul className="space-y-1 font-mono text-xs">
                      {c.toolEvents.map((t) => (
                        <li key={t.id}>
                          {t.id} {t.name} → <b>{t.status}</b> {t.error ? `(${t.error})` : t.output ? JSON.stringify(t.output) : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <em>none recorded</em>
                  )}
                </Row>
              </dl>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <fieldset>
            <legend className="text-sm font-medium">2. Select checks</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {DEMO_RUBRICS.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5 text-sm hover:border-line-strong">
                  <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="mt-0.5 accent-accent" />
                  <span>
                    <span className="block font-mono text-xs">{r.id}</span>
                    <span className="block text-fg-muted">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">3. Run</legend>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Evaluation mode">
                <button type="button" role="radio" aria-checked={mode === "simulated"} onClick={() => chooseMode("simulated")} className={`rounded px-3 py-1 text-sm ${mode === "simulated" ? "bg-fg text-bg" : ""}`}>
                  Simulated
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "live"}
                  disabled={!liveStatus.live}
                  title={liveStatus.live ? `Real Jev via ${liveStatus.model}` : "Live mode is not enabled on this deployment"}
                  onClick={() => liveStatus.live && chooseMode("live")}
                  className={`rounded px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${mode === "live" ? "bg-fg text-bg" : ""}`}
                >
                  Live{liveStatus.live ? "" : " (off)"}
                </button>
              </div>
              <button
                type="button"
                onClick={run}
                disabled={running || selected.length === 0}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong disabled:opacity-60"
              >
                {running ? "Running…" : "Run checks"}
              </button>
            </div>
            <p className="mt-2 text-xs text-fg-muted">
              {liveStatus.live
                ? "Live mode sends this preset (and only this preset) to TypeSafe from the server. Results are real and may differ from the expectation."
                : "Live mode is off on this deployment. Run real evaluations locally with the CLI and your own TypeSafe key."}
            </p>
          </fieldset>

          <div aria-live="polite" aria-busy={running}>
            {error ? (
              <p className="rounded-md border border-fail/40 bg-fail-soft p-3 text-sm text-fail" role="alert">
                {error}
              </p>
            ) : null}
            {result ? <Results result={result.result} mode={result.mode} expectation={preset.expectation} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-faint">{label}</dt>
      <dd className="mt-1 break-words">{children}</dd>
    </div>
  );
}

function Results({ result, mode, expectation }: { result: CaseResult; mode: Mode; expectation: string }) {
  const counts = { pass: 0, fail: 0, review: 0, skipped: 0, error: 0 } as Record<CheckResult["status"], number>;
  for (const ch of result.checks) counts[ch.status] += 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{mode === "live" ? "Live result" : "Simulated result"}</span>
        <span className="text-fg-faint">·</span>
        <span className="text-fg-muted">
          {result.request ? (
            <>
              model <span className="font-mono">{result.request.model}</span> · {result.request.questionCount} question{result.request.questionCount === 1 ? "" : "s"} in one request
              {mode === "live" ? ` · ${result.request.usage.inputTokens} input tokens · ${result.request.latencyMs} ms` : " · usage and latency not measured"}
            </>
          ) : (
            "no judge request was needed"
          )}
        </span>
      </div>
      {result.error ? (
        <p className="rounded-md border border-error/40 bg-error-soft p-3 text-sm" role="alert">
          The judge request failed ({result.error.kind}): {result.error.message}. Checks that needed it are marked <b>error</b>, not fail.
        </p>
      ) : null}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {result.checks.map((ch) => (
          <li key={ch.rubricId} className="p-3">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={ch.status} />
                <span className="font-mono text-xs">{ch.rubricId}</span>
                <span className="text-xs text-fg-faint">{ch.severity}</span>
              </summary>
              <div className="mt-2 space-y-2 text-sm">
                <p>
                  <span className="font-medium">Why:</span> {ch.reason}
                </p>
                {ch.rule ? (
                  <p className="text-fg-muted">
                    <span className="font-medium">Rule applied by code:</span> {ch.rule}
                  </p>
                ) : null}
                {ch.answers
                  ? Object.entries(ch.answers).map(([key, a]) => (
                      <div key={key}>
                        <p className="font-mono text-xs text-fg-faint">{key}</p>
                        <ul className="mt-1 space-y-1">
                          {Object.entries(a.probabilities)
                            .sort((x, y) => y[1] - x[1])
                            .map(([label, p]) => (
                              <li key={label} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-2 text-xs">
                                <span className={`font-mono ${label === a.choice ? "font-semibold" : ""}`}>{label}</span>
                                <span className="h-2 overflow-hidden rounded bg-bg-code" aria-hidden="true">
                                  <span className="block h-full bg-fg-muted" style={{ width: `${Math.round(p * 100)}%` }} />
                                </span>
                                <span className="text-right tabular-nums">{(p * 100).toFixed(0)}%</span>
                              </li>
                            ))}
                        </ul>
                        <p className="mt-1 text-xs text-fg-faint">Provider confidence statistic {a.confidence.toFixed(2)} — describes the distribution shape, not accuracy.</p>
                      </div>
                    ))
                  : null}
                <p className="text-xs text-fg-faint">Evidence shown to the judge: {ch.evidence.fields.join(", ") || "none"}</p>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <p className="text-sm text-fg-muted">{expectation}</p>
      <p className="text-xs text-fg-muted">
        <b>Fail</b> means the judge found the response unacceptable with enough probability. <b>Review</b> means the evidence was insufficient or the
        distribution did not reach a threshold: a person should look. Missing tool logs are never treated as proof of failure.
      </p>
    </div>
  );
}
