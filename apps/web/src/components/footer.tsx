import Link from "next/link";
import { CONTACT_EMAIL, JEV_DOCS_URL } from "@/lib/site";

export function Footer({ repoUrl }: { repoUrl: string | null }) {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-4 sm:px-6">
        <div className="sm:col-span-2">
          <p className="font-semibold">jeval</p>
          <p className="mt-2 max-w-sm text-fg-muted">
            Open-source evaluations for AI outputs and agents, judged by Jev. An independent project that uses TypeSafe&rsquo;s
            technology; not affiliated with TypeSafe.
          </p>
        </div>
        <div>
          <p className="font-medium">Product</p>
          <ul className="mt-2 space-y-1.5 text-fg-muted">
            <li><Link href="/docs" className="hover:text-fg">Docs</Link></li>
            <li><Link href="/demo" className="hover:text-fg">Demo</Link></li>
            <li><Link href="/cloud" className="hover:text-fg">jeval Cloud waitlist</Link></li>
            {repoUrl ? <li><a href={repoUrl} className="hover:text-fg" rel="noopener">Source on GitHub</a></li> : <li className="text-fg-faint">Source: publishing soon</li>}
          </ul>
        </div>
        <div>
          <p className="font-medium">More</p>
          <ul className="mt-2 space-y-1.5 text-fg-muted">
            <li><Link href="/docs/limitations" className="hover:text-fg">Limitations</Link></li>
            <li><Link href="/privacy" className="hover:text-fg">Privacy</Link></li>
            <li><a href={JEV_DOCS_URL} className="hover:text-fg" rel="noopener">TypeSafe docs</a></li>
            <li><a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-fg">Contact: {CONTACT_EMAIL}</a></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-8 text-xs text-fg-faint sm:px-6">
        MIT licensed. Jev and TypeSafe are trademarks of their respective owner. Support and waitlist questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2 hover:text-fg">{CONTACT_EMAIL}</a>.
      </div>
    </footer>
  );
}
