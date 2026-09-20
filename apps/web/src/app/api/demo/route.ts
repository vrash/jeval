import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { checkBotId } from "botid/server";
import { JevProvider } from "@jeval/provider-jev";
import { DEMO_PRESET_IDS, DEMO_RUBRICS, getPreset } from "@/lib/demo/presets";
import { runDemoPreset } from "@/lib/demo/run";
import { createDemoBudgetFromEnv } from "@/lib/demo-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const MAX_CONCURRENT = 2;
const RATE_LIMIT = { perIp: 10, windowSeconds: 600 };
let inFlight = 0;

const BodySchema = z.object({
  presetId: z.enum(DEMO_PRESET_IDS),
  rubricIds: z.array(z.enum(DEMO_RUBRICS.map((r) => r.id) as [string, ...string[]])).min(1).max(DEMO_RUBRICS.length),
});

/**
 * Live public demo is enabled only when every control is configured:
 * a server-side TypeSafe key, the explicit flag, and a shared budget backend (Supabase).
 */
function liveConfig() {
  const enabled = process.env.DEMO_LIVE_ENABLED === "true";
  const apiKey = process.env.TYPESAFE_API_KEY;
  const budget = createDemoBudgetFromEnv(process.env);
  const ceiling = Number.parseInt(process.env.DEMO_DAILY_REQUEST_CEILING ?? "200", 10);
  const secret = process.env.WAITLIST_RATE_LIMIT_SECRET;
  const ready = enabled && !!apiKey && !!budget && Number.isFinite(ceiling) && ceiling > 0 && !!secret;
  return { ready, apiKey, budget, ceiling, secret, model: process.env.DEMO_MODEL ?? "jev-latest" };
}

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const { ready, model } = liveConfig();
  return NextResponse.json({ live: ready, model: ready ? model : null }, { headers: noStore });
}

export async function POST(request: Request) {
  const cfg = liveConfig();
  if (!cfg.ready) {
    return NextResponse.json({ ok: false, error: "live_disabled", message: "Live evaluation is not enabled on this deployment. The demo runs on simulated fixtures." }, { status: 503, headers: noStore });
  }
  const verification = await checkBotId();
  if (verification.isBot) {
    return NextResponse.json({ ok: false, error: "bot_detected", message: "Automated requests are not accepted." }, { status: 403, headers: noStore });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: noStore });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: noStore });
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(JSON.parse(text));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400, headers: noStore });
  }
  const preset = getPreset(parsed.presetId);
  if (!preset) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400, headers: noStore });

  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim();
  const ipKey = "demo:" + createHmac("sha256", cfg.secret!).update(ip).digest("hex");
  try {
    if (!(await cfg.budget!.consumeRateLimit(ipKey, RATE_LIMIT.perIp, RATE_LIMIT.windowSeconds))) {
      return NextResponse.json({ ok: false, error: "rate_limited", message: "Too many live requests from this network. Try again later or use the simulated mode." }, { status: 429, headers: { ...noStore, "Retry-After": String(RATE_LIMIT.windowSeconds) } });
    }
    if (!(await cfg.budget!.consumeDailyBudget(cfg.ceiling))) {
      return NextResponse.json({ ok: false, error: "budget_exhausted", message: "The live demo has reached today's usage ceiling. Simulated mode is still available." }, { status: 429, headers: noStore });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "budget_unavailable", message: "Live evaluation is temporarily unavailable." }, { status: 503, headers: noStore });
  }

  if (inFlight >= MAX_CONCURRENT) {
    return NextResponse.json({ ok: false, error: "busy", message: "The live demo is busy. Please retry in a moment." }, { status: 503, headers: { ...noStore, "Retry-After": "5" } });
  }
  inFlight += 1;
  try {
    const provider = new JevProvider({ apiKey: cfg.apiKey!, model: cfg.model, timeoutMs: 20_000 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const { result } = await runDemoPreset(preset, parsed.rubricIds, provider, controller.signal);
      // Errors are preserved in the result (per-check `error` statuses); never swapped for fixtures.
      return NextResponse.json({ ok: true, mode: "live", result }, { headers: noStore });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: "provider_error", message: error instanceof Error ? error.message : "Live evaluation failed." }, { status: 502, headers: noStore });
  } finally {
    inFlight -= 1;
  }
}
