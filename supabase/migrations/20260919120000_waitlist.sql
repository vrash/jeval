-- jeval Cloud waitlist + shared abuse-control tables.
--
-- Access model (see https://supabase.com/docs/guides/database/postgres/row-level-security):
--   * Every table here has Row Level Security enabled and NO policies. With RLS on and no
--     policies, anon and authenticated get nothing through the Data API. Because a policy is
--     not a grant, we also REVOKE the table privileges from anon/authenticated so nothing is
--     reachable even if a policy were added by mistake later.
--   * The Supabase `service_role` has the BYPASSRLS attribute, so it ignores RLS entirely.
--     It is the only role the website server uses (via SUPABASE_SERVICE_ROLE_KEY, server-side
--     only) and the only role granted privileges below.
--   * Functions are SECURITY DEFINER with a pinned search_path and schema-qualified names, and
--     EXECUTE is revoked from PUBLIC/anon/authenticated so they cannot be called via the API.
--
-- Privacy: nothing in this migration stores IP addresses, user agents, request URLs, query
-- strings, referrers, cookies or browser fingerprints, and no such columns should be added.
-- Rate-limit bucket keys are HMAC-SHA256 digests computed by the server with a secret that
-- never enters the database, so a bucket key cannot be reversed into an IP or an email.
--
-- The migration is idempotent where practical (IF NOT EXISTS / CREATE OR REPLACE) so it can be
-- re-applied through `supabase db push` or pasted into the SQL editor more than once.

-- ---------------------------------------------------------------------------
-- waitlist_signups
-- ---------------------------------------------------------------------------
create table if not exists public.waitlist_signups (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  use_case        text null,
  source          text not null default 'site',
  campaign        text null,
  notice_version  text not null,
  created_at      timestamptz not null default now(),

  constraint waitlist_signups_email_unique unique (email),
  -- The server normalises before insert; the DB refuses anything that is not normalised so a
  -- case/whitespace variant can never create a second row for the same address.
  constraint waitlist_signups_email_normalised check (email = lower(btrim(email))),
  constraint waitlist_signups_email_length check (char_length(email) between 3 and 254),
  -- Deliberately simple: one "@", no whitespace, something on both sides. Full RFC 5322
  -- validation is not the goal; deliverability is verified when we actually email people.
  constraint waitlist_signups_email_format check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint waitlist_signups_use_case_length check (use_case is null or char_length(use_case) <= 280),
  constraint waitlist_signups_source_allowed check (source in ('site', 'docs', 'demo', 'cloud-page')),
  constraint waitlist_signups_campaign_format check (campaign is null or campaign ~ '^[a-z0-9-]{1,40}$'),
  constraint waitlist_signups_notice_version_format check (notice_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);

comment on table public.waitlist_signups is
  'jeval Cloud early-access waitlist. One row per email address. Contains only what the person typed '
  '(email, optional use case), where the form lived (source/campaign) and which privacy notice they '
  'saw (notice_version). No IP address, user agent, URL, referrer or fingerprint columns exist and none '
  'must be added. Retention: kept until the person asks for deletion or the waitlist is closed; '
  'delete with scripts/waitlist-admin.mjs.';
comment on column public.waitlist_signups.email is 'Lower-cased, trimmed address. Unique.';
comment on column public.waitlist_signups.use_case is 'Optional free text from the person, max 280 chars. Never overwritten by repeat submissions.';
comment on column public.waitlist_signups.source is 'Which part of the site hosted the form.';
comment on column public.waitlist_signups.campaign is 'Optional short slug set by the site (not a raw query string).';
comment on column public.waitlist_signups.notice_version is 'Date-stamped version of the privacy notice shown at submission.';

create index if not exists waitlist_signups_created_at_idx on public.waitlist_signups (created_at);

alter table public.waitlist_signups enable row level security;
revoke all on table public.waitlist_signups from public, anon, authenticated;
grant select, insert, update, delete on table public.waitlist_signups to service_role;

-- ---------------------------------------------------------------------------
-- rate_limit_buckets
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_buckets (
  bucket_key    text primary key,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  constraint rate_limit_buckets_hits_nonnegative check (hits >= 0)
);

comment on table public.rate_limit_buckets is
  'Fixed-window rate-limit counters shared by all server instances. bucket_key is an HMAC-SHA256 '
  'digest produced by the server (never a raw IP address or email). Retention: rows are transient; '
  'prune_rate_limit_buckets() deletes buckets whose window started more than one day ago.';

alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_buckets to service_role;

-- Atomically counts one hit against p_key. Returns true when the hit is within p_limit for the
-- current p_window_seconds window, false when it would exceed it. Safe under concurrency: the
-- whole decision is a single INSERT ... ON CONFLICT DO UPDATE, so two racing callers serialise on
-- the row and each sees the other's increment.
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'consume_rate_limit: invalid arguments';
  end if;

  insert into public.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update
    set window_start = case
          when b.window_start + make_interval(secs => p_window_seconds) <= now() then now()
          else b.window_start
        end,
        hits = case
          when b.window_start + make_interval(secs => p_window_seconds) <= now() then 1
          else b.hits + 1
        end
  returning b.hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Counts one hit in a fixed window and reports whether it is allowed. Service role only.';

revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Deletes buckets whose window started more than one day ago. Run from a cron job or by hand.
create or replace function public.prune_rate_limit_buckets() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limit_buckets
   where window_start < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.prune_rate_limit_buckets() is
  'Removes rate-limit buckets older than one day. Returns the number of rows deleted. Service role only.';

revoke execute on function public.prune_rate_limit_buckets() from public, anon, authenticated;
grant execute on function public.prune_rate_limit_buckets() to service_role;

-- ---------------------------------------------------------------------------
-- demo_usage
-- ---------------------------------------------------------------------------
create table if not exists public.demo_usage (
  day       date primary key,
  requests  integer not null default 0,
  constraint demo_usage_requests_nonnegative check (requests >= 0)
);

comment on table public.demo_usage is
  'One row per UTC day counting live-demo requests across all server instances, used to enforce '
  'DEMO_DAILY_REQUEST_CEILING. Holds counts only; nothing about who made the requests. '
  'Retention: rows are tiny and may be kept indefinitely or deleted at will.';

alter table public.demo_usage enable row level security;
revoke all on table public.demo_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.demo_usage to service_role;

-- Atomically increments today's (UTC) counter. Returns true when the request fits under
-- p_ceiling, false when it would exceed it. Refused requests do not bump the counter. The
-- conditional UPDATE is a single statement, so racing callers serialise on the day row and the
-- counter can never pass p_ceiling.
create or replace function public.consume_demo_budget(p_ceiling integer) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_ceiling is null or p_ceiling < 0 then
    raise exception 'consume_demo_budget: invalid ceiling';
  end if;

  insert into public.demo_usage (day, requests)
  values (v_day, 0)
  on conflict (day) do nothing;

  update public.demo_usage
     set requests = requests + 1
   where day = v_day
     and requests < p_ceiling;

  return found;
end;
$$;

comment on function public.consume_demo_budget(integer) is
  'Increments today''s live-demo request counter if it is below p_ceiling. Service role only.';

revoke execute on function public.consume_demo_budget(integer) from public, anon, authenticated;
grant execute on function public.consume_demo_budget(integer) to service_role;
