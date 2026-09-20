import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared abuse controls for the live demo, backed by the same Supabase functions the waitlist
 * uses (see supabase/migrations/20260919120000_waitlist.sql). Keys passed to consumeRateLimit
 * must already be hashed by the caller; never pass a raw IP address or email.
 */
export interface DemoBudget {
  consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  /** Counts one request against today's UTC ceiling; false when the ceiling would be exceeded. */
  consumeDailyBudget(ceiling: number): Promise<boolean>;
}

export class DemoBudgetUnavailableError extends Error {
  override readonly name = "DemoBudgetUnavailableError";
  constructor(operation: string, cause?: unknown) {
    super(`demo budget unavailable during ${operation}`, { cause });
  }
}

export class SupabaseDemoBudget implements DemoBudget {
  constructor(private readonly client: SupabaseClient) {}

  static fromCredentials(url: string, serviceRoleKey: string): SupabaseDemoBudget {
    const client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return new SupabaseDemoBudget(client);
  }

  private async callBoolean(fn: string, args: Record<string, unknown>): Promise<boolean> {
    let result: { data: unknown; error: { message: string } | null };
    try {
      result = await this.client.rpc(fn, args);
    } catch (cause) {
      throw new DemoBudgetUnavailableError(fn, cause);
    }
    if (result.error) throw new DemoBudgetUnavailableError(fn, new Error(result.error.message));
    if (typeof result.data !== "boolean") throw new DemoBudgetUnavailableError(fn, new Error("unexpected rpc result"));
    return result.data;
  }

  consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    return this.callBoolean("consume_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  }

  consumeDailyBudget(ceiling: number): Promise<boolean> {
    return this.callBoolean("consume_demo_budget", { p_ceiling: ceiling });
  }
}

/** Accepts process.env or any plain string map (index signature keeps it assignable from ProcessEnv). */
export type DemoBudgetEnv = Record<string, string | undefined>;

/** Null when Supabase is not configured; callers should then keep the demo on fixtures. */
export function createDemoBudgetFromEnv(env: DemoBudgetEnv): DemoBudget | null {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return SupabaseDemoBudget.fromCredentials(url, key);
}
