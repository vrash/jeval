import type { Comparison } from "./compare.js";
import type { CheckResult, RunReport } from "./results.js";
import type { CheckStatus } from "./schemas.js";

/** Escape text for safe inclusion in HTML content and attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "✓ pass",
  fail: "✗ fail",
  review: "? review",
  skipped: "– skipped",
  error: "! error",
};

function pct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

function num(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined ? "n/a" : v.toFixed(digits);
}

const CSS = `
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1a1a1a;--muted:#5f5b53;--line:#d9d5cc;--accent:#c2410c;--pass:#166534;--fail:#b91c1c;--review:#a16207;--skip:#6b7280;--err:#7c3aed;--code:#f1efe9}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececec;--muted:#a3a3a3;--line:#2e2e2e;--accent:#fb923c;--pass:#4ade80;--fail:#f87171;--review:#facc15;--skip:#9ca3af;--err:#c4b5fd;--code:#1c1c1c}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg);padding:24px;max-width:1100px;margin-inline:auto}
h1,h2,h3{line-height:1.2;letter-spacing:-.01em}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:32px 0 12px;border-top:1px solid var(--line);padding-top:24px}h3{font-size:16px;margin:16px 0 8px}
.muted{color:var(--muted)}.banner{border:1px solid var(--accent);color:var(--accent);padding:10px 14px;border-radius:6px;margin:16px 0;font-weight:600}
table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600;color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:12px 0}.stat{border:1px solid var(--line);border-radius:6px;padding:10px 12px}.stat b{display:block;font-size:22px;font-weight:600}.stat span{font-size:12px;color:var(--muted)}
.s{font-weight:600;white-space:nowrap}.s-pass{color:var(--pass)}.s-fail{color:var(--fail)}.s-review{color:var(--review)}.s-skipped{color:var(--skip)}.s-error{color:var(--err)}
details{border:1px solid var(--line);border-radius:6px;margin:8px 0;padding:0 12px}summary{cursor:pointer;padding:10px 0;font-weight:600}details[open]>summary{border-bottom:1px solid var(--line)}
pre{background:var(--code);padding:10px 12px;border-radius:6px;overflow:auto;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:6px 0 12px}
code{font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:1px 4px;border-radius:3px}
.bar{display:flex;height:10px;border-radius:5px;overflow:hidden;border:1px solid var(--line);margin:6px 0}.bar i{display:block;height:100%}.bar .pass{background:var(--pass)}.bar .fail{background:var(--fail)}.bar .review{background:var(--review)}.bar .skipped{background:var(--skip)}.bar .error{background:var(--err)}
.crit{border:1px solid var(--fail);border-radius:6px;padding:10px 14px;margin:12px 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:8px 0}dt{color:var(--muted)}dd{margin:0}
footer{margin-top:40px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
`;

function statusCell(status: CheckStatus): string {
  return `<span class="s s-${status}">${escapeHtml(STATUS_LABEL[status])}</span>`;
}

function bar(counts: Record<CheckStatus, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return "";
  const seg = (k: CheckStatus) =>
    counts[k] > 0 ? `<i class="${k}" style="width:${((counts[k] / total) * 100).toFixed(2)}%" title="${k}: ${counts[k]}"></i>` : "";
  return `<div class="bar" role="img" aria-label="${escapeHtml(
    `pass ${counts.pass}, fail ${counts.fail}, review ${counts.review}, skipped ${counts.skipped}, error ${counts.error}`,
  )}">${seg("pass")}${seg("fail")}${seg("review")}${seg("skipped")}${seg("error")}</div>`;
}

function renderAnswers(check: CheckResult): string {
  if (!check.answers) return "";
  return Object.entries(check.answers)
    .map(([k, a]) => {
      const rows = Object.entries(a.probabilities)
        .sort((x, y) => y[1] - x[1])
        .map(([label, p]) => `<tr><td><code>${escapeHtml(label)}</code></td><td>${(p * 100).toFixed(1)}%</td></tr>`)
        .join("");
      return `<h3>Question <code>${escapeHtml(k)}</code></h3>
<p>Selected: <code>${escapeHtml(a.choice)}</code> · provider confidence statistic: ${a.confidence.toFixed(2)} <span class="muted">(distribution shape, not accuracy)</span></p>
<table><thead><tr><th>Outcome</th><th>Probability</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join("");
}

function renderCheck(check: CheckResult): string {
  return `<details>
<summary>${statusCell(check.status)} &nbsp; <code>${escapeHtml(check.rubricId)}</code> <span class="muted">v${escapeHtml(check.rubricVersion)} · ${escapeHtml(check.kind)} · ${escapeHtml(check.severity)}${check.required ? "" : " · optional"}</span></summary>
<dl>
<dt>Reason</dt><dd>${escapeHtml(check.reason)}</dd>
${check.rule ? `<dt>Rule</dt><dd>${escapeHtml(check.rule)}</dd>` : ""}
${check.outcome ? `<dt>Outcome</dt><dd><code>${escapeHtml(check.outcome)}</code></dd>` : ""}
<dt>Thresholds</dt><dd>pass ≥ ${check.thresholds.pass} · fail ≥ ${check.thresholds.fail}</dd>
<dt>Evidence shown</dt><dd>${escapeHtml(check.evidence.fields.join(", ") || "none")}${check.evidence.contextIds.length ? ` · references: ${escapeHtml(check.evidence.contextIds.join(", "))}` : ""}${check.evidence.toolEventIds.length ? ` · tool events: ${escapeHtml(check.evidence.toolEventIds.join(", "))}` : ""}</dd>
${check.error ? `<dt>Error</dt><dd>${escapeHtml(check.error.kind)}: ${escapeHtml(check.error.message)}</dd>` : ""}
</dl>
<h3>Criterion as sent</h3><pre>${escapeHtml(check.criterion)}</pre>
${renderAnswers(check)}
</details>`;
}

export function renderRunHtml(report: RunReport, options: { title?: string } = {}): string {
  const s = report.summary;
  const title = options.title ?? `Jeval run ${report.runId.slice(0, 8)}`;
  const simulatedBanner = report.simulated
    ? `<div class="banner" role="status">Simulated results: this run used the ${escapeHtml(report.provider.id)} provider. Outcomes, usage and latency are not measurements.</div>`
    : "";
  const critical = s.criticalFailures > 0 ? `<div class="crit"><b>${s.criticalFailures} critical failure(s)</b> — listed first below regardless of averages.</div>` : "";
  const cost = report.cost
    ? `$${report.cost.amount.toFixed(4)} <span class="muted">(estimate at $${report.cost.inputRatePerMillionTokens}/M input tokens, rate as of ${escapeHtml(report.cost.rateAsOf)})</span>`
    : `<span class="muted">unknown${report.simulated ? " (simulated run)" : " (no pricing configured)"}</span>`;

  const rubricRows = s.perRubric
    .map(
      (r) => `<tr><td><code>${escapeHtml(r.rubricId)}</code> <span class="muted">v${escapeHtml(r.rubricVersion)}</span></td><td>${escapeHtml(r.severity)}${r.required ? "" : " (optional)"}</td>
<td class="s-pass">${r.counts.pass}</td><td class="s-fail">${r.counts.fail}</td><td class="s-review">${r.counts.review}</td><td class="s-skipped">${r.counts.skipped}</td><td class="s-error">${r.counts.error}</td>
<td>${pct(r.passRateDecided)}</td><td>${pct(r.decidedCoverage)}</td></tr>`,
    )
    .join("");

  const ordered = [...report.cases].sort((a, b) => {
    const ca = a.checks.filter((c) => c.status === "fail" && c.severity === "critical").length;
    const cb = b.checks.filter((c) => c.status === "fail" && c.severity === "critical").length;
    if (ca !== cb) return cb - ca;
    const fa = a.checks.filter((c) => c.status === "fail").length;
    const fb = b.checks.filter((c) => c.status === "fail").length;
    return fb - fa;
  });

  const caseBlocks = ordered
    .map((c) => {
      const counts = { pass: 0, fail: 0, review: 0, skipped: 0, error: 0 } as Record<CheckStatus, number>;
      for (const ch of c.checks) counts[ch.status] += 1;
      const head = (["fail", "error", "review", "pass", "skipped"] as CheckStatus[])
        .filter((k) => counts[k] > 0)
        .map((k) => `<span class="s s-${k}">${counts[k]} ${k}</span>`)
        .join(" · ");
      const req = c.request
        ? `<dt>Request</dt><dd>model <code>${escapeHtml(c.request.model)}</code> · ${c.request.questionCount} question(s) in one request · ${c.request.usage.inputTokens} input / ${c.request.usage.outputTokens} output tokens · ${c.request.simulated ? "simulated latency" : `${c.request.latencyMs} ms`} · ${c.request.attempts} attempt(s)${c.request.requestId ? ` · id ${escapeHtml(c.request.requestId)}` : ""}</dd>`
        : "";
      const err = c.error ? `<dt>Case error</dt><dd class="s-error">${escapeHtml(c.error.kind)}: ${escapeHtml(c.error.message)}</dd>` : "";
      return `<details${counts.fail > 0 || counts.error > 0 ? " open" : ""}>
<summary><code>${escapeHtml(c.caseId)}</code> &nbsp; ${head}</summary>
<dl>${req}${err}${c.metadata ? `<dt>Metadata</dt><dd><code>${escapeHtml(JSON.stringify(c.metadata))}</code></dd>` : ""}</dl>
${c.checks.map(renderCheck).join("")}
</details>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title)}</title><style>${CSS}</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="muted">Run <code>${escapeHtml(report.runId)}</code> · ${escapeHtml(report.createdAt)} · mode <b>${escapeHtml(report.mode)}</b> · provider <code>${escapeHtml(report.provider.id)}</code> · model <code>${escapeHtml(report.provider.model ?? "n/a")}</code> · dataset ${escapeHtml(report.dataset.path ?? "(in memory)")} (${report.dataset.caseCount} cases, fingerprint <code>${escapeHtml(report.dataset.fingerprint)}</code>)</p>
${simulatedBanner}
${critical}
<h2>Summary</h2>
${bar(s.counts)}
<div class="grid">
<div class="stat"><b class="s-pass">${s.counts.pass}</b><span>pass</span></div>
<div class="stat"><b class="s-fail">${s.counts.fail}</b><span>fail</span></div>
<div class="stat"><b class="s-review">${s.counts.review}</b><span>review</span></div>
<div class="stat"><b class="s-skipped">${s.counts.skipped}</b><span>skipped</span></div>
<div class="stat"><b class="s-error">${s.counts.error}</b><span>error</span></div>
<div class="stat"><b>${pct(s.passRateDecided)}</b><span>pass rate of decided checks (pass ÷ (pass + fail))</span></div>
<div class="stat"><b>${pct(s.passRateApplicable)}</b><span>pass rate of applicable checks (pass ÷ (all − skipped))</span></div>
<div class="stat"><b>${pct(s.decidedCoverage)}</b><span>decided coverage ((pass + fail) ÷ (all − skipped))</span></div>
<div class="stat"><b>${pct(s.reviewRate)}</b><span>review rate</span></div>
<div class="stat"><b>${pct(s.errorRate)}</b><span>error rate</span></div>
</div>
<dl>
<dt>Cases</dt><dd>${s.caseCount} (${s.caseErrors} with case-level errors)</dd>
<dt>Checks</dt><dd>${s.checkCount}</dd>
<dt>Requests</dt><dd>${s.usage.requests} · ${s.usage.inputTokens} input tokens · ${s.usage.outputTokens} output tokens (request-level, counted once per case)</dd>
<dt>Latency</dt><dd>${report.simulated ? '<span class="muted">not measured (simulated)</span>' : `mean ${num(s.latencyMs.mean)} ms · p50 ${num(s.latencyMs.p50)} ms · p95 ${num(s.latencyMs.p95)} ms · max ${num(s.latencyMs.max)} ms`}</dd>
<dt>Estimated cost</dt><dd>${cost}</dd>
<dt>Thresholds</dt><dd>pass ≥ ${report.thresholds.pass} · fail ≥ ${report.thresholds.fail} (starting points; validate on your data)</dd>
</dl>
<h2>Per rubric</h2>
<table><thead><tr><th>Rubric</th><th>Severity</th><th>Pass</th><th>Fail</th><th>Review</th><th>Skipped</th><th>Error</th><th>Pass rate (decided)</th><th>Decided coverage</th></tr></thead><tbody>${rubricRows}</tbody></table>
<h2>Cases</h2>
<p class="muted">Cases with critical failures are listed first, then by number of failures. Evaluated text is shown escaped; nothing in it can execute.</p>
${caseBlocks}
<footer>Generated by Jeval. Probabilities and the provider confidence statistic are shown as returned; confidence describes the distribution shape and is not an accuracy measurement.</footer>
</body></html>`;
}

export function renderComparisonHtml(comparison: Comparison): string {
  const t = (rows: Comparison["newFailures"], empty: string) =>
    rows.length === 0
      ? `<p class="muted">${escapeHtml(empty)}</p>`
      : `<table><thead><tr><th>Case</th><th>Rubric</th><th>Before</th><th>After</th><th>Reason (after)</th></tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr><td><code>${escapeHtml(r.caseId)}</code></td><td><code>${escapeHtml(r.rubricId)}</code></td><td>${r.before ? statusCell(r.before) : "—"}</td><td>${r.after ? statusCell(r.after) : "—"}</td><td>${escapeHtml(r.afterReason ?? "")}</td></tr>`,
          )
          .join("")}</tbody></table>`;
  const issues = comparison.compatibility.issues
    .map((i) => `<li><b>${escapeHtml(i.severity)}</b> (${escapeHtml(i.field)}): ${escapeHtml(i.message)}</li>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Jeval comparison</title><style>${CSS}</style></head><body>
<h1>Jeval comparison</h1>
<p class="muted">Baseline <code>${escapeHtml(comparison.baseline.runId)}</code> (${escapeHtml(comparison.baseline.mode)}, ${escapeHtml(comparison.baseline.model ?? "n/a")}) → candidate <code>${escapeHtml(comparison.candidate.runId)}</code> (${escapeHtml(comparison.candidate.mode)}, ${escapeHtml(comparison.candidate.model ?? "n/a")})</p>
${comparison.compatibility.compatible ? "" : `<div class="banner">Runs are not fully comparable. See compatibility issues.</div>`}
<h2>Compatibility</h2>${issues ? `<ul>${issues}</ul>` : `<p class="muted">Same dataset, rubrics, model, thresholds and mode.</p>`}
<h2>Alignment</h2><dl><dt>Shared cases</dt><dd>${comparison.alignment.sharedCases}</dd><dt>Only in baseline</dt><dd>${comparison.alignment.onlyInBaseline.length}</dd><dt>Only in candidate</dt><dd>${comparison.alignment.onlyInCandidate.length}</dd><dt>Comparable rubrics</dt><dd>${escapeHtml(comparison.alignment.sharedRubrics.join(", ") || "none")}</dd><dt>Unchanged checks</dt><dd>${comparison.unchanged}</dd></dl>
<h2>New failures (${comparison.newFailures.length})</h2>${t(comparison.newFailures, "No new failures.")}
<h2>Resolved failures (${comparison.resolvedFailures.length})</h2>${t(comparison.resolvedFailures, "No resolved failures.")}
<h2>New reviews (${comparison.newReviews.length})</h2>${t(comparison.newReviews, "No new reviews.")}
<h2>New errors (${comparison.newErrors.length})</h2>${t(comparison.newErrors, "No new errors.")}
<h2>Other changes (${comparison.otherChanges.length})</h2>${t(comparison.otherChanges, "No other changes.")}
</body></html>`;
}
