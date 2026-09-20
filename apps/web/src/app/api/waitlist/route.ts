import { handleWaitlistRequest } from "@/lib/waitlist/handler";
import { createWaitlistStoreFromEnv } from "@/lib/waitlist/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

function allowedOriginsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const origins = new Set<string>();
  const add = (value: string | undefined) => {
    const origin = toOrigin(value);
    if (origin) origins.add(origin);
  };
  add(env.NEXT_PUBLIC_SITE_URL);
  for (const entry of (env.WAITLIST_ALLOWED_ORIGINS ?? "").split(",")) add(entry);
  if (env.VERCEL_URL) add(`https://${env.VERCEL_URL}`);
  // Production alias (e.g. <project>.vercel.app) differs from the deployment URL; allow it too.
  if (env.VERCEL_PROJECT_PRODUCTION_URL) add(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (env.VERCEL_BRANCH_URL) add(`https://${env.VERCEL_BRANCH_URL}`);
  if (env.NODE_ENV === "development") add("http://localhost:3000");
  return [...origins];
}

export async function POST(request: Request): Promise<Response> {
  return handleWaitlistRequest(request, {
    store: createWaitlistStoreFromEnv(process.env),
    allowedOrigins: allowedOriginsFromEnv(process.env),
    rateLimitSecret: process.env.WAITLIST_RATE_LIMIT_SECRET,
  });
}

/** There is deliberately no listing endpoint; the data is read only via the admin script. */
export async function GET(): Promise<Response> {
  return new Response(JSON.stringify({ ok: false, message: "Method not allowed." }), {
    status: 405,
    headers: {
      allow: "POST",
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
