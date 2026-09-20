import type { Metadata } from "next";
import { NOTICE_VERSION } from "@/lib/waitlist/constants";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What the Jeval website stores, what it deliberately does not, and how to get your waitlist entry deleted.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-2 text-sm text-fg-muted">Describes how this site actually handles data. Notice version {NOTICE_VERSION}.</p>
      <div className="prose mt-8">
        <h2>Waitlist</h2>
        <p>When you join the Jeval Cloud waitlist, the server stores:</p>
        <ul>
          <li>your email address, lower-cased and trimmed, used as a unique key so repeat signups do not create duplicates;</li>
          <li>the optional answer to &ldquo;What would you use Jeval to evaluate?&rdquo; (up to 280 characters), kept from your first signup only;</li>
          <li>the page the form was on (site, docs, demo or cloud page) and an optional short campaign tag from an allowlist;</li>
          <li>the version of the notice shown to you and the time of signup.</li>
        </ul>
        <p>
          The waitlist does not store IP addresses, user-agent strings, page URLs, query strings or browser fingerprints. Rate limiting uses a keyed
          hash of the request&rsquo;s network address and email that is discarded after a day and cannot be reversed without the server secret.
        </p>
        <p>
          Data lives in a Supabase Postgres database. Anonymous database access is denied by row-level security and revoked grants; only the
          server endpoint that handles the form can write, using a server-only credential. There is no public list, no email automation and no
          analytics on this site.
        </p>
        <p>
          We use the email only to contact you about Jeval Cloud early access. Entries are kept until you ask for deletion or the waitlist closes.
          To be removed, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address you signed up with; an operator deletes the
          row with a script and confirms.
        </p>
        <h2>Demo</h2>
        <p>
          The default demo runs simulated fixtures in your browser and sends nothing. If a deployment enables live mode, the server sends only the
          bundled preset cases to TypeSafe, never anything you type. The site does not accept free-form prompts.
        </p>
        <h2>Open-source framework</h2>
        <p>
          The SDK and CLI do not send telemetry. A live run sends the selected fields of each case to TypeSafe using your own API key, under
          TypeSafe&rsquo;s terms. Reports are written to your disk and nowhere else.
        </p>
      </div>
    </div>
  );
}
