import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WaitlistSource } from "./constants";

export interface WaitlistRecord {
  email: string;
  useCase?: string;
  source: WaitlistSource;
  campaign?: string;
  noticeVersion: string;
}

export interface WaitlistStore {
  /**
   * Inserts the record unless the email already exists. Must never overwrite an existing row:
   * a repeat submission returns "exists" and leaves the first use_case untouched.
   */
  insert(record: WaitlistRecord): Promise<"created" | "exists">;
  /** Counts one hit against `key`; resolves false when the hit exceeds `limit` in the window. */
  consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

/** Raised for any storage failure. Carries no request data, so it is safe to log. */
export class StoreUnavailableError extends Error {
  override readonly name = "StoreUnavailableError";
  constructor(operation: string, cause?: unknown) {
    super(`waitlist store unavailable during ${operation}`, { cause });
  }
}

const TABLE = "waitlist_signups";

export class SupabaseWaitlistStore implements WaitlistStore {
  constructor(private readonly client: SupabaseClient) {}

  static fromCredentials(url: string, serviceRoleKey: string): SupabaseWaitlistStore {
    // Server-side only: no session persistence, no token refresh timers.
    const client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return new SupabaseWaitlistStore(client);
  }

  async insert(record: WaitlistRecord): Promise<"created" | "exists"> {
    const row = {
      email: record.email,
      use_case: record.useCase ?? null,
      source: record.source,
      campaign: record.campaign ?? null,
      notice_version: record.noticeVersion,
    };
    // ignoreDuplicates maps to INSERT ... ON CONFLICT (email) DO NOTHING, so a concurrent or
    // repeated submission can never overwrite the existing row. Only newly inserted rows come
    // back from .select(), so an empty result means the email was already there.
    let result: { data: unknown; error: { message: string } | null };
    try {
      result = await this.client
        .from(TABLE)
        .upsert(row, { onConflict: "email", ignoreDuplicates: true })
        .select("id");
    } catch (cause) {
      throw new StoreUnavailableError("insert", cause);
    }
    if (result.error) {
      throw new StoreUnavailableError("insert", new Error(result.error.message));
    }
    return Array.isArray(result.data) && result.data.length > 0 ? "created" : "exists";
  }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    let result: { data: unknown; error: { message: string } | null };
    try {
      result = await this.client.rpc("consume_rate_limit", {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
    } catch (cause) {
      throw new StoreUnavailableError("consume_rate_limit", cause);
    }
    if (result.error) {
      throw new StoreUnavailableError("consume_rate_limit", new Error(result.error.message));
    }
    if (typeof result.data !== "boolean") {
      throw new StoreUnavailableError("consume_rate_limit", new Error("unexpected rpc result"));
    }
    return result.data;
  }
}

/** Accepts process.env or any plain string map (index signature keeps it assignable from ProcessEnv). */
export type WaitlistStoreEnv = Record<string, string | undefined>;

/**
 * Returns null when the Supabase credentials are not configured, so the endpoint can answer 503
 * instead of crashing. The key is passed straight to the client and never logged.
 */
export function createWaitlistStoreFromEnv(env: WaitlistStoreEnv): WaitlistStore | null {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return SupabaseWaitlistStore.fromCredentials(url, key);
}
