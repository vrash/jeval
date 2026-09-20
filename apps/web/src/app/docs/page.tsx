import type { Metadata } from "next";
import Link from "next/link";
import { DOC_PAGES } from "@/lib/docs-nav";

export const metadata: Metadata = { title: "Docs", description: "jeval documentation: quickstart, cases, rubrics, CLI, CI gates, Jev integration, benchmarking and limitations.", alternates: { canonical: "/docs" } };

export default function DocsIndex() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Documentation</h1>
      <p className="mt-2 max-w-2xl text-fg-muted">
        Everything runs from a clone today; package names are provisional until published. Start with the quickstart, then read how rubrics decide.
      </p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {DOC_PAGES.map((p) => (
          <li key={p.slug}>
            <Link href={`/docs/${p.slug}`} className="block h-full rounded-lg border border-line p-4 hover:border-fg">
              <span className="font-medium">{p.title}</span>
              <span className="mt-1 block text-sm text-fg-muted">{p.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
