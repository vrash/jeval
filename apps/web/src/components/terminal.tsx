"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Line = { kind: "cmd" | "out" | "pass" | "fail" | "review" | "muted"; text: string };

/**
 * Lines are taken from real runs recorded on 2026-09-19 (examples/benchmark.live.md), lightly shortened.
 * Nothing here is a measurement of your data.
 */
const SCRIPT: Line[] = [
  { kind: "cmd", text: "jeval capture exports/last-week.jsonl -o data/live.jsonl" },
  { kind: "out", text: "detected format: langfuse" },
  { kind: "out", text: "captured 10 case(s) from 10 record(s) (0 skipped, 4 with tool events)" },
  { kind: "cmd", text: "jeval estimate --dataset data/live.jsonl" },
  { kind: "out", text: "estimate: 10 cases · 10 judge requests · ~15,096 input tokens" },
  { kind: "muted", text: "  cost: ~$0.000634 (estimate at $0.042/M input tokens)" },
  { kind: "cmd", text: "jeval run --mode live --dataset data/live.jsonl --limit 3 --show" },
  { kind: "pass", text: "[1/3] hold-nw-refund-ok        policy=pass  claim=pass  promises=pass" },
  { kind: "fail", text: "[2/3] hold-hd-booking-failed   booking-claim=fail (critical)" },
  { kind: "muted", text: "      claims success but tool event t1 status=failure (SLOT_UNAVAILABLE)" },
  { kind: "review", text: "[3/3] hold-hd-warranty-claim   claim-support=review" },
  { kind: "muted", text: "      references do not cover the claim: insufficient evidence, not a contradiction" },
  { kind: "out", text: "summary: 15 checks · pass 9 · fail 1 · review 2 · skipped 3 · error 0 · latency p50 344 ms" },
  { kind: "cmd", text: "jeval review runs/live.json --labels human.jsonl" },
  { kind: "out", text: "[1/2] hold-hd-warranty-claim / claim-support → review   label [p/f/r/s/n/q]: f" },
  { kind: "out", text: "wrote 1 human label(s) to human.jsonl" },
  { kind: "cmd", text: "jeval compare runs/yesterday.json runs/live.json --fail-on-new" },
  { kind: "out", text: "shared cases 10 · comparable rubrics 5 · unchanged 47" },
  { kind: "fail", text: "new failures: 1   hold-hd-booking-failed / booking-claim: pass → fail" },
  { kind: "pass", text: "resolved failures: 2" },
  { kind: "muted", text: "exit 1 — the release gate holds until the booking bug is fixed" },
];

const COLOR: Record<Line["kind"], string> = {
  cmd: "text-fg",
  out: "text-fg-muted",
  pass: "text-pass",
  fail: "text-fail",
  review: "text-review",
  muted: "text-fg-faint",
};

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function Terminal() {
  const [count, setCount] = useState(0);
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      i += 1;
      setCount(i);
      if (i < SCRIPT.length) {
        const next = SCRIPT[i]!;
        window.setTimeout(tick, next.kind === "cmd" ? 900 : 260);
      } else {
        window.setTimeout(() => {
          if (cancelled) return;
          i = 0;
          setCount(0);
          window.setTimeout(tick, 400);
        }, 6000);
      }
    };
    const start = window.setTimeout(tick, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [reduced]);

  useEffect(() => {
    if (ref.current && !reduced) ref.current.scrollTop = ref.current.scrollHeight;
  }, [count, reduced]);

  const visible = reduced ? SCRIPT : SCRIPT.slice(0, count);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg-code">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-fg-faint">
        <span className="font-mono">one evaluation cycle</span>
        <span>lines from a recorded live run · shortened</span>
      </div>
      <div ref={ref} className="h-[22rem] overflow-y-auto px-4 py-3 font-mono text-[13px] leading-6" aria-live="off">
        {visible.map((l, i) => (
          <div key={i} className={`whitespace-pre-wrap ${COLOR[l.kind]} ${reduced ? "" : "rise"}`} style={{ ["--i" as string]: 0 }}>
            {l.kind === "cmd" ? <span className="text-accent">$ </span> : null}
            {l.text}
          </div>
        ))}
        {!reduced && count < SCRIPT.length ? <span className="caret" aria-hidden="true" /> : null}
      </div>
    </div>
  );
}
