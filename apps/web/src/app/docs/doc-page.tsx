import type { Metadata } from "next";
import { DOC_PAGES, type DocSlug } from "@/lib/docs-nav";

export function docMetadata(slug: DocSlug): Metadata {
  const page = DOC_PAGES.find((p) => p.slug === slug)!;
  return { title: page.title, description: page.description, alternates: { canonical: `/docs/${slug}` } };
}

export function DocTitle({ slug }: { slug: DocSlug }) {
  const page = DOC_PAGES.find((p) => p.slug === slug)!;
  return (
    <header className="mb-8">
      <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
      <p className="mt-2 text-fg-muted">{page.description}</p>
    </header>
  );
}
