import type { CheckStatus } from "@jeval/core";

const STYLE: Record<CheckStatus, { label: string; symbol: string; className: string }> = {
  pass: { label: "Pass", symbol: "✓", className: "bg-pass-soft text-pass border-pass/30" },
  fail: { label: "Fail", symbol: "✕", className: "bg-fail-soft text-fail border-fail/30" },
  review: { label: "Review", symbol: "?", className: "bg-review-soft text-review border-review/30" },
  skipped: { label: "Skipped", symbol: "–", className: "bg-skip-soft text-skip border-skip/30" },
  error: { label: "Error", symbol: "!", className: "bg-error-soft text-error border-error/30" },
};

export function StatusBadge({ status, size = "md" }: { status: CheckStatus; size?: "sm" | "md" }) {
  const s = STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border font-medium ${size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-sm"} ${s.className}`}
    >
      <span aria-hidden="true" className="font-mono">{s.symbol}</span>
      {s.label}
    </span>
  );
}

export const STATUS_LABELS = STYLE;
