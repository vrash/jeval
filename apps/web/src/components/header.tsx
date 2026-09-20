"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

const NAV = [
  { href: "/docs", label: "Docs" },
  { href: "/demo", label: "Demo" },
  { href: "/cloud", label: "Cloud" },
];

export function Header({ repoUrl }: { repoUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const pathname = usePathname();
  const menuId = useId();

  // Close the mobile menu after navigation without an effect: the menu is only open on the path it was opened on.
  const menuOpen = open && openedAt === pathname;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="jeval home">
          <Logo />
          <span>jeval</span>
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm hover:bg-bg-code ${isActive(item.href) ? "font-medium text-fg" : "text-fg-muted"}`}
            >
              {item.label}
            </Link>
          ))}
          {repoUrl ? (
            <a href={repoUrl} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-code" rel="noopener">
              GitHub
            </a>
          ) : null}
          <Link href="/docs/quickstart" className="ml-2 rounded-md bg-fg px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent">
            Get started
          </Link>
        </nav>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line sm:hidden"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => {
            setOpenedAt(pathname);
            setOpen(!menuOpen);
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {menuOpen ? (
        <nav id={menuId} aria-label="Primary mobile" className="border-t border-line px-4 py-3 sm:hidden">
          <ul className="flex flex-col gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 ${isActive(item.href) ? "bg-bg-code font-medium" : ""}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            {repoUrl ? (
              <li>
                <a href={repoUrl} className="block rounded-md px-3 py-2" rel="noopener">
                  GitHub
                </a>
              </li>
            ) : null}
            <li>
              <Link href="/docs/quickstart" className="mt-1 block rounded-md bg-fg px-3 py-2 font-medium text-bg">
                Get started
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor" />
      <path d="M9 20.5c0 2.5 1.8 4 4.2 4 2.6 0 4.3-1.6 4.3-4.5V8h-4v12c0 .8-.3 1.1-.8 1.1-.6 0-.8-.5-.8-1.2V19H9v1.5z" fill="var(--color-bg)" />
      <circle cx="22.5" cy="9.5" r="2.5" fill="var(--color-accent)" />
    </svg>
  );
}
