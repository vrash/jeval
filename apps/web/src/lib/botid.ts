import { checkBotId } from "botid/server";

/**
 * True when the request failed Vercel BotID's browser challenge.
 * BotID only functions on Vercel; elsewhere (local `next start`, CI, self-hosting) it is skipped
 * so the honeypot, origin allowlist and rate limits remain the controls. On Vercel a failure to
 * evaluate is treated as a bot (fail closed).
 */
export async function isBotRequest(): Promise<boolean> {
  if (!process.env.VERCEL) return false;
  try {
    const verification = await checkBotId();
    return verification.isBot;
  } catch {
    return true;
  }
}
