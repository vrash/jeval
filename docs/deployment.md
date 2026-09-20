# Deployment

One straightforward path: the Next.js site on Vercel, the waitlist on Supabase Postgres. Nothing else is required. The implementation is portable: any host that runs Next.js 16 on Node 20+ works, and the waitlist handler is framework-agnostic.

## 1. Supabase

1. Create a project (free tier is fine; keep it in the organisation that will own the waitlist).
2. Apply the migration:
   ```bash
   supabase link --project-ref <ref>
   supabase db push          # applies supabase/migrations/*.sql
   ```
   or paste `supabase/migrations/20260919120000_waitlist.sql` into the SQL editor.
3. Copy the project URL and the **service role** key (Project Settings → API). The service role key is server-only; never put it in a `NEXT_PUBLIC_*` variable or a client bundle.
4. Optional: schedule `select public.prune_rate_limit_buckets();` daily with pg_cron.

The offline test `pnpm test:web` applies the same migration to an in-memory Postgres (PGlite) and verifies that `anon`/`authenticated` cannot read or write the tables or call the functions.

## 2. Vercel

Checked against Vercel's current defaults on 2026-09-19: Node.js 24 LTS is the default runtime (Node 22 also available), Fluid Compute is on by default, and the default function timeout is 300 s. `apps/web` needs none of that tuned; the demo route caps its own work at 45 s.

1. Import the repository. Set **Root Directory** to `apps/web`; keep the framework preset (Next.js). pnpm is detected from `packageManager` and the workspace lockfile at the repo root.
2. Environment variables (Production and Preview as appropriate):

   | Variable | Scope | Purpose |
   |---|---|---|
   | `NEXT_PUBLIC_SITE_URL` | Production | Canonical origin, e.g. `https://jeval.example`. Also an allowed Origin for the waitlist POST. `VERCEL_URL`, `VERCEL_BRANCH_URL` and `VERCEL_PROJECT_PRODUCTION_URL` are always allowed as well. |
   | `NEXT_PUBLIC_REPO_URL` | All | Public repository URL. Leave unset until the repo is public; links are hidden when unset. |
   | `SUPABASE_URL` | All (server) | Supabase project URL. |
   | `SUPABASE_SERVICE_ROLE_KEY` | All (server, sensitive) | Service role key. |
   | `WAITLIST_RATE_LIMIT_SECRET` | All (server, sensitive) | Random 32+ byte secret for hashing rate-limit keys. `openssl rand -hex 32`. |
   | `WAITLIST_ALLOWED_ORIGINS` | Optional | Extra comma-separated origins allowed to POST (custom preview domains). |
   | `TYPESAFE_API_KEY` | Optional (server, sensitive) | Only if enabling the live demo. |
   | `DEMO_LIVE_ENABLED` | Optional | `true` to allow live preset evaluation. Requires the key, Supabase and the rate-limit secret; otherwise the route stays disabled. |
   | `DEMO_MODEL`, `DEMO_DAILY_REQUEST_CEILING` | Optional | Model id and hard daily request ceiling (default 200) for the live demo. |

3. Deploy. Previews are served with `X-Robots-Tag: noindex` and a disallow-all `robots.txt`; only `VERCEL_ENV=production` is indexable and emits the sitemap.
4. Verify: load `/`, `/demo`, `/docs/quickstart`; submit the waitlist form with an identifiable test address (e.g. `waitlist-test+<date>@yourdomain`), confirm the row with `node scripts/waitlist-admin.mjs count`, then delete it with `node scripts/waitlist-admin.mjs delete --email <address>`.

Without the Supabase variables the site still deploys; the form shows "temporarily unavailable" and saves nothing. Without `NEXT_PUBLIC_SITE_URL` in production the canonical URL falls back to the Vercel production URL.

## Budgets before enabling live inference

Set a Vercel spend limit, keep `DEMO_DAILY_REQUEST_CEILING` small, and check TypeSafe's dashboard for the key's usage. The demo route also limits each network address to 10 live requests per 10 minutes and runs at most 2 live evaluations concurrently per instance.

## Current state (2026-09-19)

- Vercel project `jeval` exists in the `vrash1` personal scope with Root Directory `apps/web`. The first CLI deployment (`vercel deploy` from the repo root) was assigned to production by Vercel, so the site is served at https://jeval.vercel.app with no environment variables set: the waitlist form shows the honest unavailable state and the demo runs simulated fixtures only.
- Deployment-specific and preview URLs are behind Vercel Authentication. A "Protection Bypass for Automation" secret was generated on the project (Settings → Deployment Protection) for verification requests; rotate or delete it if unwanted.
- No Supabase project has been created for Jeval yet. Create one, apply the migration, add the variables in the table above with `vercel env add`, and redeploy before announcing the waitlist.
- Domain: `getjeval.com` (Namecheap) and `www.getjeval.com` are attached to the project; www redirects (308) to the apex. `NEXT_PUBLIC_SITE_URL=https://getjeval.com` is set for Production. DNS at Namecheap must point `@` and `www` A records to `76.76.21.21` (or use Vercel nameservers ns1/ns2.vercel-dns.com).
- To take the site down: `vercel remove jeval` (or delete the project in the dashboard).

## Local production check

```bash
pnpm build:web
cd apps/web && NEXT_PUBLIC_SITE_URL=http://localhost:3000 pnpm exec next start
```
