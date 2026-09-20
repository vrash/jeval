import Link from "next/link";
import { DOC_PAGES } from "@/lib/docs-nav";
import { DocsNav } from "./nav";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-faint">
          <Link href="/docs">Documentation</Link>
        </p>
        <DocsNav pages={DOC_PAGES.map((p) => ({ slug: p.slug, title: p.title }))} />
      </aside>
      <article className="min-w-0">{children}</article>
    </div>
  );
}
