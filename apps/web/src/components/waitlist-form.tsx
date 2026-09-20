"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { NOTICE_TEXT, NOTICE_VERSION } from "@/lib/waitlist/constants";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "network"; message: string };

export function WaitlistForm({ source = "site", compact = false }: { source?: "site" | "docs" | "demo" | "cloud-page"; compact?: boolean }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [email, setEmail] = useState("");
  const [useCase, setUseCase] = useState("");
  const [website, setWebsite] = useState("");
  const id = useId();
  const emailId = `${id}-email`;
  const useCaseId = `${id}-usecase`;
  const statusId = `${id}-status`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setState({ kind: "invalid", message: "Enter a valid email address." });
      return;
    }
    if (useCase.length > 280) {
      setState({ kind: "invalid", message: "Keep the use case under 280 characters." });
      return;
    }
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmed, useCase: useCase.trim() || undefined, source, noticeVersion: NOTICE_VERSION, website }),
      });
      let body: { ok?: boolean; message?: string; unavailable?: boolean } = {};
      try {
        body = await res.json();
      } catch {
        body = {};
      }
      if (res.ok && body.ok) {
        setState({ kind: "success", message: body.message ?? "You're on the list." });
        setEmail("");
        setUseCase("");
      } else if (res.status === 503 || body.unavailable) {
        setState({ kind: "unavailable", message: body.message ?? "The waitlist is temporarily unavailable. Nothing was saved." });
      } else if (res.status === 429) {
        setState({ kind: "rate_limited", message: body.message ?? "Too many attempts. Please try again later." });
      } else {
        setState({ kind: "invalid", message: body.message ?? "Please check the email address and try again." });
      }
    } catch {
      setState({ kind: "network", message: "Network error. Your signup was not sent; please try again." });
    }
  }

  const disabled = state.kind === "loading";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3" aria-describedby={statusId}>
      <div className={compact ? "flex flex-col gap-2 sm:flex-row" : "space-y-3"}>
        <div className="flex-1">
          <label htmlFor={emailId} className="block text-sm font-medium">
            Email
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={disabled}
            aria-invalid={state.kind === "invalid" ? true : undefined}
            className="mt-1 w-full rounded-md border border-line-strong bg-bg-elevated px-3 py-2 text-sm placeholder:text-fg-faint"
            placeholder="you@company.com"
          />
        </div>
        {!compact ? (
          <div>
            <label htmlFor={useCaseId} className="block text-sm font-medium">
              What would you use jeval to evaluate? <span className="font-normal text-fg-muted">(optional)</span>
            </label>
            <textarea
              id={useCaseId}
              name="useCase"
              rows={2}
              maxLength={280}
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-line-strong bg-bg-elevated px-3 py-2 text-sm placeholder:text-fg-faint"
              placeholder="e.g. a support assistant that books appointments"
            />
            <p className="mt-1 text-xs text-fg-faint">{useCase.length}/280</p>
          </div>
        ) : null}
        {/* Honeypot: hidden from people, filled by bots. Submissions with it filled are discarded server-side. */}
        <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
          <label htmlFor={`${id}-website`}>Website</label>
          <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <div className={compact ? "sm:self-end" : ""}>
          <button type="submit" disabled={disabled} className="rounded-md bg-fg px-4 py-2 text-sm font-medium text-bg hover:bg-accent disabled:opacity-60">
            {state.kind === "loading" ? "Joining…" : "Join the Cloud waitlist"}
          </button>
        </div>
      </div>
      <p className="text-xs text-fg-muted">
        {NOTICE_TEXT} See the <Link href="/privacy" className="underline underline-offset-2">privacy page</Link> for what is stored.
      </p>
      <div id={statusId} aria-live="polite" className="min-h-5 text-sm">
        {state.kind === "success" ? (
          <p className="rounded-md border border-pass/40 bg-pass-soft px-3 py-2 text-pass" role="status">
            ✓ {state.message}
          </p>
        ) : null}
        {state.kind === "invalid" ? (
          <p className="text-fail" role="alert">
            {state.message}
          </p>
        ) : null}
        {state.kind === "unavailable" || state.kind === "network" || state.kind === "rate_limited" ? (
          <p className="rounded-md border border-review/40 bg-review-soft px-3 py-2 text-review" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
