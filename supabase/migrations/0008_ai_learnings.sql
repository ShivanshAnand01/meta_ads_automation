-- Migration 0008 — what the AI has learned, per business.
--
-- manager_memory is an episodic feed: things happened, newest first. A
-- learning is different — it has a lifecycle. A failure that recurs is counted,
-- not duplicated; it is marked resolved when the same action later works; the
-- owner can dismiss one that is wrong. One row per (business, kind, signature).
--
--   pitfall           something that failed, and why (from tool results)
--   fix               what made a past pitfall go away
--   owner_preference  what the owner wants, extracted from their own messages
--   owner_feedback    what the owner approved or rejected
--   operating_note    the AI's own working rules for this business, rewritten
--                     by the weekly retrospective from the rows above
--   platform_suggestion  improvements for the developer, from the retrospective
--
-- Owner RLS; background learning writes with the service role. Idempotent.

begin;

create table if not exists public.ai_learnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in
    ('pitfall', 'fix', 'owner_preference', 'owner_feedback', 'operating_note', 'platform_suggestion')),
  -- Dedupe key: the same lesson seen again updates this row.
  signature text not null,
  statement text not null,
  detail jsonb not null default '{}'::jsonb,
  -- tool_failure · readiness · approval · creative_review · chat · retrospective
  source text not null,
  occurrences int not null default 1,
  confidence numeric(3, 2) not null default 0.5 check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active', 'resolved', 'dismissed')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  unique (user_id, kind, signature)
);

create index if not exists ai_learnings_user_idx on public.ai_learnings (user_id, status, kind, last_seen desc);

alter table public.ai_learnings enable row level security;
drop policy if exists ai_learnings_owner on public.ai_learnings;
create policy ai_learnings_owner on public.ai_learnings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.ai_learnings to authenticated;
grant all on public.ai_learnings to service_role;

commit;
