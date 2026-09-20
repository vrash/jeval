/**
 * Offline integration test: runs the real migration inside PGlite (Postgres compiled to WASM)
 * and checks the access model and the SQL functions. No Docker or Supabase project needed.
 *
 * PGlite runs as the superuser `postgres`, so `SET ROLE anon` works and we exercise the grants
 * the same way Postgres would for a real anon connection. The has_*_privilege() checks are kept
 * as well so the intent is visible even if role switching ever changes in PGlite.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StoreUnavailableError, SupabaseWaitlistStore } from "./store";

const MIGRATION_PATH = fileURLToPath(
  new URL("../../../../../supabase/migrations/20260919120000_waitlist.sql", import.meta.url),
);

const CREATE_ROLES = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;`;

const INSERT_SQL =
  "insert into public.waitlist_signups (email, use_case, notice_version) values ($1, $2, '2026-09-19') on conflict (email) do nothing returning id";

describe("waitlist migration in PGlite", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(CREATE_ROLES);
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    await db.exec(sql);
    // Idempotency: applying twice must not fail.
    await db.exec(sql);
  });

  afterAll(async () => {
    await db.close();
  });

  const asRole = async <T>(role: string, fn: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };

  it("(a) denies anon and authenticated any access to waitlist_signups", async () => {
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, async () => {
        await expect(db.query("select * from public.waitlist_signups")).rejects.toThrow(/permission denied/);
        await expect(
          db.query("insert into public.waitlist_signups (email, notice_version) values ('x@y.io', '2026-09-19')"),
        ).rejects.toThrow(/permission denied/);
        await expect(db.query("select * from public.rate_limit_buckets")).rejects.toThrow(/permission denied/);
        await expect(db.query("select * from public.demo_usage")).rejects.toThrow(/permission denied/);
      });
      const priv = await db.query<{ s: boolean; i: boolean }>(
        "select has_table_privilege($1, 'public.waitlist_signups', 'SELECT') as s, has_table_privilege($1, 'public.waitlist_signups', 'INSERT') as i",
        [role],
      );
      expect(priv.rows[0]).toEqual({ s: false, i: false });
    }
    const rls = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.waitlist_signups'::regclass",
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    const policies = await db.query<{ n: string }>("select count(*)::text as n from pg_policies where schemaname = 'public'");
    expect(policies.rows[0]?.n).toBe("0");
  });

  it("(b) lets service_role insert and read", async () => {
    const inserted = await asRole("service_role", () =>
      db.query<{ id: string }>(INSERT_SQL, ["service@example.com", "via service role"]),
    );
    expect(inserted.rows).toHaveLength(1);
    const read = await asRole("service_role", () =>
      db.query<{ email: string }>("select email from public.waitlist_signups where email = 'service@example.com'"),
    );
    expect(read.rows[0]?.email).toBe("service@example.com");
  });

  it("(c) keeps the first use_case when the same email is inserted concurrently", async () => {
    const [r1, r2] = await Promise.all([
      db.query<{ id: string }>(INSERT_SQL, ["race@example.com", "first"]),
      db.query<{ id: string }>(INSERT_SQL, ["race@example.com", "second"]),
    ]);
    expect(r1.rows.length + r2.rows.length).toBe(1);
    const rows = await db.query<{ use_case: string }>(
      "select use_case from public.waitlist_signups where email = 'race@example.com'",
    );
    expect(rows.rows).toEqual([{ use_case: "first" }]);
  });

  it("(d) rejects emails that are not lower-cased and trimmed", async () => {
    await expect(db.query(INSERT_SQL, ["Upper@Example.com", null])).rejects.toThrow(/waitlist_signups_email_normalised/);
    // Leading whitespace fails both the normalisation and the format CHECK; Postgres reports
    // whichever it evaluates first, and either is the correct outcome.
    await expect(db.query(INSERT_SQL, [" padded@example.com", null])).rejects.toThrow(
      /waitlist_signups_email_(normalised|format)/,
    );
    await expect(db.query(INSERT_SQL, ["padded@example.com ", null])).rejects.toThrow(
      /waitlist_signups_email_(normalised|format)/,
    );
    await expect(db.query(INSERT_SQL, ["no-at-sign", null])).rejects.toThrow(/waitlist_signups_email_format/);
    await expect(
      db.query("insert into public.waitlist_signups (email, use_case, notice_version) values ('u@example.com', $1, '2026-09-19')", [
        "x".repeat(281),
      ]),
    ).rejects.toThrow(/waitlist_signups_use_case_length/);
    await expect(
      db.query("insert into public.waitlist_signups (email, notice_version, source) values ('s@example.com', '2026-09-19', 'email')"),
    ).rejects.toThrow(/waitlist_signups_source_allowed/);
    await expect(
      db.query("insert into public.waitlist_signups (email, notice_version, campaign) values ('c@example.com', '2026-09-19', 'Bad Campaign')"),
    ).rejects.toThrow(/waitlist_signups_campaign_format/);
  });

  it("has no columns for IP addresses, user agents, URLs or fingerprints", async () => {
    const cols = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'waitlist_signups'",
    );
    const names = cols.rows.map((r) => r.column_name).sort();
    expect(names).toEqual(["campaign", "created_at", "email", "id", "notice_version", "source", "use_case"]);
  });

  it("(e) consume_rate_limit allows N hits, blocks N+1, and resets after the window", async () => {
    const call = async () =>
      (await db.query<{ ok: boolean }>("select public.consume_rate_limit('bucket-1', 3, 600) as ok")).rows[0]?.ok;
    expect(await call()).toBe(true);
    expect(await call()).toBe(true);
    expect(await call()).toBe(true);
    expect(await call()).toBe(false);
    expect(await call()).toBe(false);
    // Simulate the window elapsing.
    await db.query("update public.rate_limit_buckets set window_start = window_start - interval '11 minutes' where bucket_key = 'bucket-1'");
    expect(await call()).toBe(true);
    const bucket = await db.query<{ hits: number }>("select hits from public.rate_limit_buckets where bucket_key = 'bucket-1'");
    expect(bucket.rows[0]?.hits).toBe(1);

    // Prune: an old bucket goes, a fresh one stays.
    await db.query("update public.rate_limit_buckets set window_start = now() - interval '2 days' where bucket_key = 'bucket-1'");
    await db.query("select public.consume_rate_limit('bucket-2', 3, 600)");
    const pruned = await db.query<{ n: number }>("select public.prune_rate_limit_buckets() as n");
    expect(pruned.rows[0]?.n).toBe(1);
    const remaining = await db.query<{ bucket_key: string }>("select bucket_key from public.rate_limit_buckets");
    expect(remaining.rows).toEqual([{ bucket_key: "bucket-2" }]);
  });

  it("(f) consume_demo_budget enforces the ceiling and does not count refused requests", async () => {
    const call = async (ceiling: number) =>
      (await db.query<{ ok: boolean }>("select public.consume_demo_budget($1) as ok", [ceiling])).rows[0]?.ok;
    expect(await call(2)).toBe(true);
    expect(await call(2)).toBe(true);
    expect(await call(2)).toBe(false);
    expect(await call(2)).toBe(false);
    const usage = await db.query<{ requests: number }>("select requests from public.demo_usage");
    expect(usage.rows).toEqual([{ requests: 2 }]);
    // Raising the ceiling lets the next request through.
    expect(await call(3)).toBe(true);
    expect(await call(0)).toBe(false);
  });

  it("(g) anon and authenticated cannot execute the functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, async () => {
        await expect(db.query("select public.consume_rate_limit('k', 1, 60)")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.consume_demo_budget(1)")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.prune_rate_limit_buckets()")).rejects.toThrow(/permission denied/);
      });
      const priv = await db.query<{ f: boolean }>(
        "select has_function_privilege($1, 'public.consume_rate_limit(text,integer,integer)', 'EXECUTE') as f",
        [role],
      );
      expect(priv.rows[0]?.f).toBe(false);
    }
    const svc = await db.query<{ f: boolean }>(
      "select has_function_privilege('service_role', 'public.consume_rate_limit(text,integer,integer)', 'EXECUTE') as f",
    );
    expect(svc.rows[0]?.f).toBe(true);
  });
});

/** Minimal stand-in shaped like the parts of supabase-js the store touches. */
function fakeSupabase(opts: {
  upsert?: (row: unknown, options: unknown) => { data: unknown; error: { message: string } | null };
  rpc?: (fn: string, args: unknown) => { data: unknown; error: { message: string } | null };
}) {
  const calls: { table?: string; row?: unknown; options?: unknown; selected?: string; rpc?: [string, unknown] }[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(row: unknown, options: unknown) {
          const call = { table, row, options };
          calls.push(call);
          return {
            select(columns: string) {
              (call as { selected?: string }).selected = columns;
              return Promise.resolve(opts.upsert ? opts.upsert(row, options) : { data: [], error: null });
            },
          };
        },
      };
    },
    rpc(fn: string, args: unknown) {
      calls.push({ rpc: [fn, args] });
      return Promise.resolve(opts.rpc ? opts.rpc(fn, args) : { data: true, error: null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("SupabaseWaitlistStore", () => {
  const record = { email: "a@example.com", useCase: "x", source: "site" as const, noticeVersion: "2026-09-19" };

  it("maps a returned row to 'created' and uses an ignore-duplicates upsert on email", async () => {
    const { client, calls } = fakeSupabase({ upsert: () => ({ data: [{ id: "uuid" }], error: null }) });
    const store = new SupabaseWaitlistStore(client);
    await expect(store.insert(record)).resolves.toBe("created");
    expect(calls[0]).toMatchObject({
      table: "waitlist_signups",
      row: { email: "a@example.com", use_case: "x", source: "site", campaign: null, notice_version: "2026-09-19" },
      options: { onConflict: "email", ignoreDuplicates: true },
      selected: "id",
    });
  });

  it("maps an empty result to 'exists'", async () => {
    const { client } = fakeSupabase({ upsert: () => ({ data: [], error: null }) });
    await expect(new SupabaseWaitlistStore(client).insert(record)).resolves.toBe("exists");
  });

  it("throws StoreUnavailableError on a Supabase error", async () => {
    const { client } = fakeSupabase({ upsert: () => ({ data: null, error: { message: "connection refused" } }) });
    await expect(new SupabaseWaitlistStore(client).insert(record)).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("calls consume_rate_limit via rpc and returns its boolean", async () => {
    const { client, calls } = fakeSupabase({ rpc: () => ({ data: false, error: null }) });
    await expect(new SupabaseWaitlistStore(client).consumeRateLimit("k", 5, 600)).resolves.toBe(false);
    expect(calls[0]?.rpc).toEqual(["consume_rate_limit", { p_key: "k", p_limit: 5, p_window_seconds: 600 }]);
  });

  it("throws StoreUnavailableError when rpc errors", async () => {
    const { client } = fakeSupabase({ rpc: () => ({ data: null, error: { message: "timeout" } }) });
    await expect(new SupabaseWaitlistStore(client).consumeRateLimit("k", 5, 600)).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });
});
