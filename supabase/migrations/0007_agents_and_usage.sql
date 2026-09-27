-- Migration 0007 — the agent team (runs, playbook) and an AI cost ledger.
--
-- agent_runs      one row per specialist run the Brain delegates: the brief,
--                 the validated report, the tool calls, tokens and cost. Runs
--                 are also the queue: background runs wait here as 'queued'.
-- creative_playbook  what won and what lost for this business, with the numbers
--                 behind it. The creative generator and the Editor read the top
--                 entries before they write; the analyst and Watcher write them.
--                 A table rather than tagged memory rows: each lesson carries
--                 structured evidence and can be updated or retired, which a
--                 free-text memory feed cannot.
-- ai_usage        one row per paid model call (chat, routines, creatives,
--                 images, specialists) with tokens and cost in USD, so the
--                 running cost of the platform is measured, not estimated.
--
-- Owner RLS on all three; writes from background runs use the service role.
-- Explicit grants, as in 0005. Idempotent; safe to re-run.

begin;

-- ── agent_runs ──────────────────────────────────────────────────────────

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null,
  parent_run_id uuid references public.agent_runs(id) on delete set null,
  conversation_id text,
  brief text not null,
  mode text not null default 'interactive' check (mode in ('interactive', 'background')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  report jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists agent_runs_user_idx on public.agent_runs (user_id, created_at desc);
create index if not exists agent_runs_queue_idx on public.agent_runs (status, created_at) where status = 'queued';

alter table public.agent_runs enable row level security;
drop policy if exists agent_runs_owner on public.agent_runs;
create policy agent_runs_owner on public.agent_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.agent_runs to authenticated;
grant all on public.agent_runs to service_role;

-- ── creative_playbook ───────────────────────────────────────────────────

create table if not exists public.creative_playbook (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- What the lesson is about.
  dimension text not null check (dimension in
    ('hook', 'offer', 'image', 'copy', 'audience', 'placement', 'format', 'timing', 'other')),
  finding text not null,
  verdict text not null check (verdict in ('won', 'lost', 'neutral')),
  -- The numbers behind it, e.g. {"metric":"ctr","value":2.1,"baseline":1.3,"impressions":4000}.
  evidence jsonb not null default '{}'::jsonb,
  sample_size int not null default 0,
  confidence numeric(3, 2) not null default 0.5 check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active', 'retired')),
  source_agent text,
  source_run_id uuid references public.agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creative_playbook_user_idx
  on public.creative_playbook (user_id, status, confidence desc);

alter table public.creative_playbook enable row level security;
drop policy if exists creative_playbook_owner on public.creative_playbook;
create policy creative_playbook_owner on public.creative_playbook
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists creative_playbook_touch on public.creative_playbook;
create trigger creative_playbook_touch
  before update on public.creative_playbook
  for each row execute function public.touch_updated_at();

grant select, insert, update, delete on public.creative_playbook to authenticated;
grant all on public.creative_playbook to service_role;

-- ── ai_usage ────────────────────────────────────────────────────────────

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Where the call came from: chat, autonomous:<routine>, reflection,
  -- creative:generate, image, agent:<id>, …
  source text not null,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  cached_input_tokens int not null default 0,
  output_tokens int not null default 0,
  -- Null when the model has no known price; tokens are still recorded.
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
-- Owners may read and append their own usage; never edit or delete it.
drop policy if exists ai_usage_owner_read on public.ai_usage;
create policy ai_usage_owner_read on public.ai_usage for select using (auth.uid() = user_id);
drop policy if exists ai_usage_owner_insert on public.ai_usage;
create policy ai_usage_owner_insert on public.ai_usage for insert with check (auth.uid() = user_id);

grant select, insert on public.ai_usage to authenticated;
grant all on public.ai_usage to service_role;

commit;
