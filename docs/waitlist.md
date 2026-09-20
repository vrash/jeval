# jeval Cloud waitlist

The waitlist form on the website posts to `POST /api/waitlist`, which writes to a Supabase
Postgres table. This page describes exactly what the implementation does, for operators and for
the privacy page. It does not promise anything the code does not do.

## What is stored

One row per email address in `public.waitlist_signups`:

| Column           | Content                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| `id`             | Random UUID.                                                                |
| `email`          | The address typed in the form, lower-cased and trimmed. Unique.             |
| `use_case`       | Optional free text from the person, at most 280 characters.                 |
| `source`         | Which part of the site hosted the form: `site`, `docs`, `demo`, `cloud-page`. |
| `campaign`       | Optional short slug set by the site (`[a-z0-9-]{1,40}`), e.g. `launch-week`. |
| `notice_version` | The date-stamped version of the privacy notice shown when they submitted.   |
| `created_at`     | Timestamp of the first submission.                                          |

A repeat submission of the same address does nothing: the first `use_case` is kept and the
person gets the same success message either way, so the endpoint does not reveal whether an
address is already registered.

The notice shown next to the form is `NOTICE_TEXT` in
`apps/web/src/lib/waitlist/constants.ts`, version `NOTICE_VERSION`. Change the date whenever the
wording changes; submissions carrying an old version are rejected.

## What is deliberately not stored

- IP addresses
- User agents or any other request headers
- Page URLs, query strings or referrers
- Cookies, device or browser fingerprints

The table has no columns for these, the migration says so in a comment, and the request handler
never logs request data (including the email) on success or failure. The two operational tables
(`rate_limit_buckets`, `demo_usage`) hold counters only.

## Rate limiting

`public.rate_limit_buckets` keeps fixed-window counters. The server derives the bucket key as
`HMAC-SHA256(WAITLIST_RATE_LIMIT_SECRET, "ip:" + first-hop address)` and
`HMAC-SHA256(secret, "email:" + address)`; only the hex digest reaches the database, so a bucket
key cannot be turned back into an address without the server secret. Limits: 5 submissions per
10 minutes per client key and 3 per 10 minutes per email key; over the limit the endpoint answers
`429` with `Retry-After: 600`. If the secret is unset the server logs one warning and hashes with
a built-in constant instead (still never a raw address); set the secret in production.

`public.prune_rate_limit_buckets()` deletes buckets whose window started more than one day ago.
Run it from a scheduled job (for example a `pg_cron` schedule in the Supabase dashboard) or by
hand; the table stays small either way.

The live demo shares the same function for its per-client limit and uses
`public.consume_demo_budget(ceiling)` with `DEMO_DAILY_REQUEST_CEILING` to cap requests per UTC
day across all instances (`public.demo_usage`, one counter row per day).

## Who can read the data

- All three tables have Row Level Security enabled with no policies, and all privileges are
  revoked from `anon` and `authenticated`. Requests with the publishable/anon key are denied.
- The three SQL functions are `SECURITY DEFINER` with a pinned `search_path`; `EXECUTE` is
  revoked from `PUBLIC`, `anon` and `authenticated`, so they cannot be called through the Data
  API either.
- Only `service_role` is granted access. It bypasses RLS by design, so the service-role key is
  used exclusively on the server (`SUPABASE_SERVICE_ROLE_KEY`, never `NEXT_PUBLIC_*`) and by the
  admin script below.
- There is no public listing endpoint. `GET /api/waitlist` returns `405`.

## Retention

Rows are kept until the person asks for deletion or until the waitlist is closed, at which point
the table is exported for onboarding and then dropped. Rate-limit buckets are transient (pruned
after a day). Demo usage rows are per-day counters and may be deleted at will.

## Export, count and delete

`scripts/waitlist-admin.mjs` talks to Supabase with the service-role key. It resolves
`@supabase/supabase-js` from `apps/web`, so run `pnpm install` first.

```bash
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service role key>

node scripts/waitlist-admin.mjs count
node scripts/waitlist-admin.mjs export            # JSON array, ordered by created_at
node scripts/waitlist-admin.mjs export --csv       # same rows as CSV
node scripts/waitlist-admin.mjs delete --email Someone@Example.com   # prints the number of rows removed
```

`pnpm waitlist:export` and `pnpm waitlist:delete --email <address>` (root `package.json`
scripts) are shortcuts for the last two. The script exits with status 2 and a message when the env vars are missing, and never
prints the key. To answer a deletion request, run `delete` with the address the person gives
you; it is normalised (trimmed, lower-cased) before matching.

## Applying the migration

The schema lives in `supabase/migrations/20260919120000_waitlist.sql` and is safe to apply more
than once. Either:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

or paste the file into the SQL editor of the Supabase dashboard and run it. The migration only
grants to `service_role`, so it does not matter whether the Data API exposes the `public` schema.

## Environment variables (`apps/web`)

| Variable                     | Purpose                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `SUPABASE_URL`               | Project URL. Without it (or the key) the endpoint answers `503` and saves nothing. |
| `SUPABASE_SERVICE_ROLE_KEY`  | Service-role key. Server only.                                                     |
| `WAITLIST_RATE_LIMIT_SECRET` | Random string used to HMAC rate-limit keys.                                        |
| `WAITLIST_ALLOWED_ORIGINS`   | Comma-separated extra origins allowed to POST (preview deployments etc.).          |
| `NEXT_PUBLIC_SITE_URL`       | Canonical site URL; its origin is always allowed.                                  |
| `DEMO_DAILY_REQUEST_CEILING` | Daily cap for the live demo, enforced through `consume_demo_budget`.               |

On Vercel, `VERCEL_URL` and `VERCEL_BRANCH_URL` are added to the allowed origins automatically,
and `http://localhost:3000` is allowed in development. A request whose `Origin` is not in the
list gets `403`; a request without an `Origin` header is accepted only when
`Sec-Fetch-Site` is `same-origin` or `none`.

## Running the offline test

`apps/web/src/lib/waitlist/pglite.test.ts` loads the migration into PGlite (Postgres in WASM, no
Docker) and checks the grants, RLS state, constraints, the race-safe insert and both counter
functions. `handler.test.ts` covers the HTTP behaviour with an in-memory store.

```bash
pnpm --filter @jeval/web test
```
