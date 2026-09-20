import type { Metadata } from "next";
import { WaitlistForm } from "@/components/waitlist-form";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Jeval Cloud waitlist",
  description: "Jeval Cloud is a planned managed service: hosted runs, saved history, shared dashboards and alerts. Join the waitlist.",
  alternates: { canonical: "/cloud" },
};

const PLANNED = [
  ["Managed runs", "Evaluate datasets without operating your own provider keys and workers."],
  ["Saved history", "Every run kept, with run-over-run comparison by case and rubric id."],
  ["Shared dashboards", "Pass, fail and review rates per rubric, visible to the whole team."],
  ["Alerts", "Notification when a new failure or a review spike appears on a monitored dataset."],
  ["Review workflows", "Assign uncertain results to people and turn their decisions into labels."],
  ["Team controls", "Projects, roles and audit history."],
];

export default function CloudPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-xs font-medium uppercase tracking-wide text-accent">Planned</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Jeval Cloud</h1>
      <p className="mt-3 max-w-2xl text-fg-muted">
        A managed service built on the open-source framework. It does not exist yet. Joining the waitlist means we may contact you about early
        access and ask what you would evaluate. Pricing is not decided.
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div>
          <h2 className="text-xl font-semibold">Planned capabilities</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {PLANNED.map(([title, body]) => (
              <li key={title} className="rounded-lg border border-line p-4">
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-sm text-fg-muted">{body}</p>
              </li>
            ))}
          </ul>

          <figure className="mt-8 rounded-xl border border-dashed border-line-strong p-4">
            <figcaption className="mb-3 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-fg-muted">
              <span>Concept sketch — not a working product</span>
              <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent-strong">concept</span>
            </figcaption>
            <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
              {["pass", "fail", "review"].map((k) => (
                <div key={k} className="rounded-md border border-line bg-bg p-3">
                  <p className="text-xs text-fg-faint">{k} rate · illustrative</p>
                  <div className="mt-2 h-10 rounded bg-bg-code" />
                </div>
              ))}
              <div className="rounded-md border border-line bg-bg p-3 sm:col-span-3">
                <p className="text-xs text-fg-faint">run history · illustrative</p>
                <div className="mt-2 space-y-1.5">
                  <div className="h-3 w-5/6 rounded bg-bg-code" />
                  <div className="h-3 w-2/3 rounded bg-bg-code" />
                  <div className="h-3 w-3/4 rounded bg-bg-code" />
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-fg-muted">The boxes above are placeholders to show layout intent. No data, metrics or screens exist yet.</p>
          </figure>
        </div>

        <div className="rounded-xl border border-line bg-bg-elevated p-5">
          <h2 className="text-lg font-semibold">Join the waitlist</h2>
          <p className="mt-1 text-sm text-fg-muted">
            One email, one optional sentence. Questions: <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">{CONTACT_EMAIL}</a>
          </p>
          <div className="mt-4">
            <WaitlistForm source="cloud-page" />
          </div>
        </div>
      </div>
    </div>
  );
}
