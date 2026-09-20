function normaliseUrl(value: string | undefined, fallback: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  try {
    return new URL(raw).origin;
  } catch {
    return fallback;
  }
}

export const SITE_NAME = "jeval";
export const SITE_TAGLINE = "Know when your AI gets it wrong.";
export const SITE_DESCRIPTION =
  "Open-source evaluations for AI outputs and agents. Define your checks, run them with Jev, and inspect failures and uncertain results.";

/** Canonical site origin. Set NEXT_PUBLIC_SITE_URL in production; previews fall back to the Vercel URL. */
export const SITE_URL = normaliseUrl(
  process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),
  "http://localhost:3000",
);

/** Public repository URL, only when the repository is actually public. Empty hides every GitHub link. */
export const REPO_URL: string | null = (() => {
  const raw = (process.env.NEXT_PUBLIC_REPO_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
})();

export const IS_PRODUCTION = process.env.VERCEL_ENV === "production";

/** Package names are provisional until published; the site never claims they are on npm. */
export const PACKAGES = {
  core: "@jeval/core",
  provider: "@jeval/provider-jev",
  cli: "@jeval/cli",
} as const;

export const JEV_DOCS_URL = "https://docs.typesafe.ai";

/** Contact address for support and waitlist questions (deletion requests included). */
export const CONTACT_EMAIL = "vrash@signalovernoise.xyz";
