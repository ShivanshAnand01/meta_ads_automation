-- Migration 0001 — ad delivery layer, metric integrity, approval expiry,
-- rate limiting.
--
-- Idempotent: safe to re-run. Apply in the Supabase SQL editor, or with
--   node --env-file=.env.local scripts/apply-schema.js supabase/migrations/0001_ads_delivery_layer.sql
--
-- Context: the app could previously only create Meta *Campaign* objects. Real
-- delivery needs Campaign → Ad Set → Ad, so we now persist the ad set and ad
-- IDs, the landing page URL, and the Page/Pixel a campaign publishes through.

begin;

-- ── campaigns: the fields a real publish needs ───────────────────────────
alter table public.campaigns add column if not exists link_url text;
alter table public.campaigns add column if not exists meta_ad_set_id text;
alter table public.campaigns add column if not exists page_id text;
alter table public.campaigns add column if not exists pixel_id text;
alter table public.campaigns add column if not exists conversion_event text;
alter table public.campaigns add column if not exists optimization_goal text;
alter table public.campaigns add column if not exists special_ad_categories text;
alter table public.campaigns add column if not exists targeting jsonb;
alter table public.campaigns add column if not exists currency text not null default 'INR';

comment on column public.campaigns.link_url is
  'Landing page for the ad. Publishing is blocked without it — an ad with no real destination spends money sending people nowhere.';

-- ── ad_creatives: link local rows to the live Meta objects ───────────────
alter table public.ad_creatives add column if not exists meta_creative_id text;
alter table public.ad_creatives add column if not exists meta_ad_id text;
alter table public.ad_creatives add column if not exists image_hash text;
alter table public.ad_creatives add column if not exists aspect_ratio text;
alter table public.ad_creatives add column if not exists image_provider text;
alter table public.ad_creatives add column if not exists variant_group text;

-- ── daily_metrics: ad-set / ad granularity + de-duplication ─────────────
-- Insights were stored campaign-level only, so "which ad is losing money?"
-- was unanswerable.
alter table public.daily_metrics add column if not exists meta_adset_id text;
alter table public.daily_metrics add column if not exists meta_ad_id text;
alter table public.daily_metrics add column if not exists level text not null default 'campaign';

-- The sync did select-then-insert with no unique constraint, so two concurrent
-- syncs duplicated every row and doubled the dashboard. Collapse existing
-- duplicates, then make it impossible at the DB level.
delete from public.daily_metrics a
using public.daily_metrics b
where a.ctid < b.ctid
  and a.user_id = b.user_id
  and a.date = b.date
  and a.level = b.level
  and coalesce(a.meta_campaign_id, '') = coalesce(b.meta_campaign_id, '')
  and coalesce(a.meta_adset_id, '') = coalesce(b.meta_adset_id, '')
  and coalesce(a.meta_ad_id, '') = coalesce(b.meta_ad_id, '');

create unique index if not exists daily_metrics_unique_row
  on public.daily_metrics (
    user_id,
    date,
    level,
    coalesce(meta_campaign_id, ''),
    coalesce(meta_adset_id, ''),
    coalesce(meta_ad_id, '')
  );

create index if not exists daily_metrics_user_date_idx
  on public.daily_metrics (user_id, date desc);

-- ── pending_approvals: stale approvals must not execute ─────────────────
-- Approving a three-day-old "pause campaign" used to run it blindly against
-- current state.
alter table public.pending_approvals add column if not exists expires_at timestamptz;

update public.pending_approvals
   set expires_at = created_at + interval '24 hours'
 where expires_at is null;

alter table public.pending_approvals
  alter column expires_at set default (now() + interval '24 hours');

create index if not exists pending_approvals_user_status_idx
  on public.pending_approvals (user_id, status);

-- ── token expiry monitoring ─────────────────────────────────────────────
alter table public.meta_connections add column if not exists last_validated_at timestamptz;
alter table public.meta_connections add column if not exists expiry_notified_at timestamptz;

-- ── rate limiting ───────────────────────────────────────────────────────
-- Serverless has no shared memory, so the counter lives in Postgres. One row
-- per user per window per bucket.
create table if not exists public.rate_limits (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  unique (user_id, bucket, window_start)
);

alter table public.rate_limits enable row level security;

drop policy if exists rate_limits_owner on public.rate_limits;
create policy rate_limits_owner on public.rate_limits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- Atomic increment-and-read. Doing this in SQL avoids the read-then-write
-- race that makes an application-level counter useless under concurrency.
create or replace function public.bump_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_window_start timestamptz,
  p_limit int
) returns table (allowed boolean, current_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, p_window_start, 1)
  on conflict (user_id, bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return query select (v_count <= p_limit), v_count;
end;
$$;

grant execute on function public.bump_rate_limit(uuid, text, timestamptz, int) to authenticated, service_role;

-- Housekeeping for old counter rows.
create or replace function public.prune_rate_limits() returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limits where window_start < now() - interval '2 days';
$$;

commit;
