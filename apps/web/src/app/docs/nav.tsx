"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DocsNav({ pages }: { pages: Array<{ slug: string; title: string }> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="mt-3">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {pages.map((p) => {
          const href = `/docs/${p.slug}`;
          const active = pathname === href;
          return (
            <li key={p.slug} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-md px-2.5 py-1.5 text-sm ${active ? "bg-bg-code font-medium" : "text-fg-muted hover:text-fg"}`}
              >
                {p.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
