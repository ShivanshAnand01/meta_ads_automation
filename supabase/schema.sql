-- ============================================================================
-- Meta Ads Platform — Supabase schema (AI Mastermind edition)
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- Idempotent: safe to re-run. Uses snake_case columns; the app data layer
-- (src/lib/db/supabase-db.ts) maps camelCase <-> snake_case.
-- Row Level Security scopes every table to the authenticated owner.
-- ============================================================================

-- Auto-update "updated_at" on every row update (mimics Prisma @updatedAt)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- meta_connections (API keys + Meta app credentials — "private info")
-- ---------------------------------------------------------------------------
create table if not exists public.meta_connections (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  app_id text not null,
  app_secret text not null,
  access_token text not null,
  token_expiry timestamptz,
  ad_account_id text,
  ad_account_name text,
  ad_account_status text,
  ad_account_currency text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists meta_connections_user_id_key on public.meta_connections(user_id);

drop trigger if exists meta_connections_set_updated_at on public.meta_connections;
create trigger meta_connections_set_updated_at
  before update on public.meta_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ai_settings (AI provider + API key per user)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_settings (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'ollama',
  api_key text,
  model text not null default 'llama3',
  base_url text,
  embedding_key text,
  whisper_key text,
  tts_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ai_settings_user_id_key on public.ai_settings(user_id);

-- backwards-compat: add the new voice keys to existing rows
alter table public.ai_settings add column if not exists embedding_key text;
alter table public.ai_settings add column if not exists whisper_key text;
alter table public.ai_settings add column if not exists tts_key text;

drop trigger if exists ai_settings_set_updated_at on public.ai_settings;
create trigger ai_settings_set_updated_at
  before update on public.ai_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.campaigns (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  objective text not null,
  status text not null default 'draft',
  budget double precision not null,
  budget_type text not null default 'daily',
  start_date timestamptz,
  end_date timestamptz,
  meta_campaign_id text,
  total_spend double precision not null default 0,
  total_revenue double precision not null default 0,
  total_impressions int not null default 0,
  total_clicks int not null default 0,
  total_conversions int not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.campaigns add column if not exists total_revenue double precision not null default 0;
alter table public.campaigns add column if not exists last_synced_at timestamptz;

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ad_creatives
-- ---------------------------------------------------------------------------
create table if not exists public.ad_creatives (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  image_url text,
  primary_text text,
  headline text,
  call_to_action text,
  targeting text,
  expected_spend double precision,
  expected_roas double precision,
  actual_spend double precision,
  actual_roas double precision,
  revenue double precision,
  impressions int,
  clicks int,
  conversions int,
  status text not null default 'draft',
  review_status text not null default 'pending',
  review_notes text,
  language text not null default 'marathi',
  audience text,
  campaign_id text references public.campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ad_creatives add column if not exists revenue double precision;

drop trigger if exists ad_creatives_set_updated_at on public.ad_creatives;
create trigger ad_creatives_set_updated_at
  before update on public.ad_creatives
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ai_conversations / ai_messages / ai_notes
-- ---------------------------------------------------------------------------
create table if not exists public.ai_conversations (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New Conversation',
  autonomous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_conversations add column if not exists autonomous boolean not null default false;

drop trigger if exists ai_conversations_set_updated_at on public.ai_conversations;
create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function public.set_updated_at();

create table if not exists public.ai_messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references public.ai_conversations(id) on delete cascade,
  role text not null,                       -- user | assistant | tool
  content text not null default '',
  tool_calls text,                          -- JSON: assistant's tool calls
  tool_results text,                        -- JSON: final tool results
  tool_call_id text,                         -- for role='tool', which call this answers
  tool_name text,                            -- for role='tool', the tool name
  created_at timestamptz not null default now()
);
alter table public.ai_messages add column if not exists tool_call_id text;
alter table public.ai_messages add column if not exists tool_name text;

create table if not exists public.ai_notes (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references public.ai_conversations(id) on delete cascade,
  title text not null,
  content text not null,
  type text not null default 'note',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- scheduled_jobs (autonomous routines that invoke the AI manager)
-- ---------------------------------------------------------------------------
create table if not exists public.scheduled_jobs (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                       -- morning_optimization | budget_pacing | anomaly_detection | weekly_report | custom
  campaign_id text references public.campaigns(id) on delete set null,
  cron_expression text not null,
  status text not null default 'active',
  last_run_at timestamptz,
  next_run_at timestamptz,
  config text,                              -- JSON: routine config / prompt
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists scheduled_jobs_set_updated_at on public.scheduled_jobs;
create trigger scheduled_jobs_set_updated_at
  before update on public.scheduled_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- account_strategy — the manager's persistent goals & guardrails
-- ---------------------------------------------------------------------------
create table if not exists public.account_strategy (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_roas double precision not null default 2.0,
  target_cpa double precision,              -- max acceptable cost per acquisition
  monthly_budget double precision,          -- INR spend cap for the month
  daily_budget_cap double precision,        -- INR daily spend guardrail
  scaling_rules text,                       -- JSON: when/how to scale winners
  guardrails text,                           -- JSON: hard limits (e.g. never spend > X, never pause > Y% at once)
  focus text,                               -- current strategic focus (free text)
  auto_optimize boolean not null default false, -- let the agent act autonomously
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists account_strategy_user_id_key on public.account_strategy(user_id);

drop trigger if exists account_strategy_set_updated_at on public.account_strategy;
create trigger account_strategy_set_updated_at
  before update on public.account_strategy
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- manager_memory — rolling log of decisions, observations & learnings
-- ---------------------------------------------------------------------------
create table if not exists public.manager_memory (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                        -- summary | decision | observation | learning | outcome
  content text not null,
  related_id text,                           -- optional: campaign/creative/conversation id
  importance int not null default 5,         -- 1-10, used to prune
  metadata text,                             -- JSON
  created_at timestamptz not null default now()
);
create index if not exists manager_memory_user_id_created_idx on public.manager_memory(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- ai_actions — full audit log of every tool the manager executes
-- ---------------------------------------------------------------------------
create table if not exists public.ai_actions (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text references public.ai_conversations(id) on delete set null,
  tool_name text not null,
  arguments text,                            -- JSON
  result text,                               -- JSON
  status text not null default 'success',    -- success | error | pending | approved | rejected
  actor text not null default 'agent',        -- agent | user | autonomous
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists ai_actions_user_id_created_idx on public.ai_actions(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- daily_metrics — real time-series performance (synced from Meta)
-- ---------------------------------------------------------------------------
create table if not exists public.daily_metrics (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id text references public.campaigns(id) on delete cascade,
  meta_campaign_id text,
  date date not null,
  spend double precision not null default 0,
  impressions int not null default 0,
  clicks int not null default 0,
  conversions int not null default 0,
  reach int not null default 0,
  frequency double precision not null default 0,
  ctr double precision not null default 0,
  cpc double precision not null default 0,
  cpm double precision not null default 0,
  revenue double precision not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists daily_metrics_user_campaign_date_idx
  on public.daily_metrics(user_id, campaign_id, date);
create index if not exists daily_metrics_user_date_idx on public.daily_metrics(user_id, date desc);

-- ---------------------------------------------------------------------------
-- pending_approvals — guardrail queue for spend-affecting Meta actions
-- ---------------------------------------------------------------------------
create table if not exists public.pending_approvals (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text references public.ai_conversations(id) on delete set null,
  tool_name text not null,
  arguments text not null,                   -- JSON: the deferred tool call
  summary text not null,                     -- human-readable plan
  risk text not null default 'medium',       -- low | medium | high
  status text not null default 'pending',    -- pending | approved | rejected | executed | expired
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  result text,                               -- JSON: execution result once approved
  created_at timestamptz not null default now()
);
create index if not exists pending_approvals_user_status_idx on public.pending_approvals(user_id, status);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.meta_connections enable row level security;
alter table public.ai_settings enable row level security;
alter table public.campaigns enable row level security;
alter table public.ad_creatives enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_notes enable row level security;
alter table public.scheduled_jobs enable row level security;
alter table public.account_strategy enable row level security;
alter table public.manager_memory enable row level security;
alter table public.ai_actions enable row level security;
alter table public.daily_metrics enable row level security;
alter table public.pending_approvals enable row level security;

-- Helper: is a conversation owned by the current user?
create or replace function public.conversation_owned(p_conversation_id text)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.ai_conversations c
    where c.id = p_conversation_id and c.user_id = auth.uid()
  );
$$;

-- Helper: is a message owned by the current user?
create or replace function public.message_owned(p_message_id text)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.ai_messages m
    join public.ai_conversations c on c.id = m.conversation_id
    where m.id = p_message_id and c.user_id = auth.uid()
  );
$$;

-- Generic owner-policy generator
create or replace function public.apply_owner_policies(p_table text)
returns void language plpgsql security definer as $$
declare
  stmt text;
begin
  for stmt in select format(
    $f$
      drop policy if exists "owner read"   on %1$I;
      drop policy if exists "owner insert" on %1$I;
      drop policy if exists "owner update" on %1$I;
      drop policy if exists "owner delete" on %1$I;
      create policy "owner read"   on %1$I for select using (user_id = auth.uid());
      create policy "owner insert" on %1$I for insert with check (user_id = auth.uid());
      create policy "owner update" on %1$I for update using (user_id = auth.uid()) with check (user_id = auth.uid());
      create policy "owner delete" on %1$I for delete using (user_id = auth.uid());
    $f$, p_table)
  loop execute stmt; end loop;
end $$;

select public.apply_owner_policies('meta_connections');
select public.apply_owner_policies('ai_settings');
select public.apply_owner_policies('campaigns');
select public.apply_owner_policies('ad_creatives');
select public.apply_owner_policies('ai_conversations');
select public.apply_owner_policies('scheduled_jobs');
select public.apply_owner_policies('account_strategy');
select public.apply_owner_policies('manager_memory');
select public.apply_owner_policies('ai_actions');
select public.apply_owner_policies('daily_metrics');
select public.apply_owner_policies('pending_approvals');

-- ai_messages / ai_notes: ownership flows through the parent conversation
drop policy if exists "owner read"   on public.ai_messages;
drop policy if exists "owner insert" on public.ai_messages;
drop policy if exists "owner update" on public.ai_messages;
drop policy if exists "owner delete" on public.ai_messages;
create policy "owner read"   on public.ai_messages for select using (public.conversation_owned(conversation_id));
create policy "owner insert" on public.ai_messages for insert with check (public.conversation_owned(conversation_id));
create policy "owner update" on public.ai_messages for update using (public.conversation_owned(conversation_id));
create policy "owner delete" on public.ai_messages for delete using (public.conversation_owned(conversation_id));

drop policy if exists "owner read"   on public.ai_notes;
drop policy if exists "owner insert" on public.ai_notes;
drop policy if exists "owner update" on public.ai_notes;
drop policy if exists "owner delete" on public.ai_notes;
create policy "owner read"   on public.ai_notes for select using (public.conversation_owned(conversation_id));
create policy "owner insert" on public.ai_notes for insert with check (public.conversation_owned(conversation_id));
create policy "owner update" on public.ai_notes for update using (public.conversation_owned(conversation_id));
create policy "owner delete" on public.ai_notes for delete using (public.conversation_owned(conversation_id));

-- ---------------------------------------------------------------------------
-- ai_message_attachments (files/images attached to chat messages)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_message_attachments (
  id text primary key default gen_random_uuid()::text,
  message_id text not null references public.ai_messages(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_type text not null,
  file_size bigint,
  storage_url text not null,
  direction text not null default 'input',
  created_at timestamptz not null default now()
);
alter table public.ai_message_attachments enable row level security;

drop policy if exists "owner read"   on public.ai_message_attachments;
drop policy if exists "owner insert" on public.ai_message_attachments;
drop policy if exists "owner update" on public.ai_message_attachments;
drop policy if exists "owner delete" on public.ai_message_attachments;
create policy "owner read"   on public.ai_message_attachments for select using (public.message_owned(message_id));
create policy "owner insert" on public.ai_message_attachments for insert with check (public.message_owned(message_id));
create policy "owner update" on public.ai_message_attachments for update using (public.message_owned(message_id));
create policy "owner delete" on public.ai_message_attachments for delete using (public.message_owned(message_id));

-- ============================================================================
-- Storage Buckets
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('ad-creative-images', 'ad-creative-images', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('knowledge-documents', 'knowledge-documents', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('voice-clips', 'voice-clips', true) on conflict (id) do nothing;

-- Storage RLS: users can manage files in their own folder (user_id/...)
drop policy if exists "users read own files" on storage.objects;
create policy "users read own files"
  on storage.objects for select
  using (bucket_id in ('chat-attachments', 'ad-creative-images', 'voice-clips')
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users insert own files" on storage.objects;
create policy "users insert own files"
  on storage.objects for insert
  with check (bucket_id in ('chat-attachments', 'ad-creative-images', 'voice-clips')
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users update own files" on storage.objects;
create policy "users update own files"
  on storage.objects for update
  using (bucket_id in ('chat-attachments', 'ad-creative-images', 'voice-clips')
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete own files" on storage.objects;
create policy "users delete own files"
  on storage.objects for delete
  using (bucket_id in ('chat-attachments', 'ad-creative-images', 'voice-clips')
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "kb users read own files" on storage.objects;
create policy "kb users read own files"
  on storage.objects for select
  using (bucket_id = 'knowledge-documents'
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "kb users insert own files" on storage.objects;
create policy "kb users insert own files"
  on storage.objects for insert
  with check (bucket_id = 'knowledge-documents'
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "kb users delete own files" on storage.objects;
create policy "kb users delete own files"
  on storage.objects for delete
  using (bucket_id = 'knowledge-documents'
    and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- pgvector extension for RAG (semantic search)
-- ============================================================================
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- knowledge_documents: user's uploaded knowledge base documents
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_documents (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_type text not null default 'text',
  content text not null default '',
  file_path text,
  file_type text,
  chunk_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.knowledge_documents enable row level security;
select public.apply_owner_policies('knowledge_documents');

-- ---------------------------------------------------------------------------
-- knowledge_chunks: embedded text chunks for semantic search
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_chunks (
  id text primary key default gen_random_uuid()::text,
  document_id text not null references public.knowledge_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  chunk_index int not null default 0,
  token_count int,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists knowledge_chunks_user_id_idx on public.knowledge_chunks(user_id);
alter table public.knowledge_chunks enable row level security;

drop policy if exists "owner read"   on public.knowledge_chunks;
drop policy if exists "owner insert" on public.knowledge_chunks;
drop policy if exists "owner update" on public.knowledge_chunks;
drop policy if exists "owner delete" on public.knowledge_chunks;
create policy "owner read"   on public.knowledge_chunks for select using (user_id = auth.uid());
create policy "owner insert" on public.knowledge_chunks for insert with check (user_id = auth.uid());
create policy "owner update" on public.knowledge_chunks for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner delete" on public.knowledge_chunks for delete using (user_id = auth.uid());

-- Semantic similarity search function
create or replace function public.match_knowledge_chunks(
  p_user_id uuid,
  p_embedding vector(1536),
  p_match_count int default 5,
  p_match_threshold float default 0.7
)
returns table (id text, document_id text, content text, similarity float)
language sql security definer stable
as $$
  select c.id, c.document_id, c.content, 1 - (c.embedding <=> p_embedding) as similarity
  from public.knowledge_chunks c
  where c.user_id = p_user_id
    and c.embedding is not null
    and 1 - (c.embedding <=> p_embedding) > p_match_threshold
  order by c.embedding <=> p_embedding
  limit p_match_count;
$$;

-- ---------------------------------------------------------------------------
-- generated_images: track all AI-generated ad creative images
-- ---------------------------------------------------------------------------
create table if not exists public.generated_images (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  image_url text not null,
  storage_path text,
  provider text not null,
  size text,
  style text,
  created_at timestamptz not null default now()
);
alter table public.generated_images enable row level security;
select public.apply_owner_policies('generated_images');

-- ============================================================================
-- Autonomous runner support
-- ============================================================================

-- A SECURITY DEFINER helper the background runner (using the service role key,
-- which bypasses RLS) calls to act on behalf of a user. It inserts an ai_message
-- as that user so the agent's own conversation history is consistent.
create or replace function public.insert_agent_message(
  p_user_id uuid,
  p_conversation_id text,
  p_role text,
  p_content text,
  p_tool_calls text default null,
  p_tool_results text default null,
  p_tool_call_id text default null,
  p_tool_name text default null
)
returns text
language sql security definer as $$
  insert into public.ai_messages
    (conversation_id, role, content, tool_calls, tool_results, tool_call_id, tool_name)
  values
    (p_conversation_id, p_role, p_content, p_tool_calls, p_tool_results, p_tool_call_id, p_tool_name)
  returning id;
$$;

-- Fetch the current account strategy (safe, definer) for the runner.
create or replace function public.get_account_strategy(p_user_id uuid)
returns public.account_strategy
language sql security definer stable as $$
  select * from public.account_strategy where user_id = p_user_id limit 1;
$$;

-- ============================================================================
-- pg_cron: schedule the autonomous AI runner.
-- Requires the pg_cron + pg_net extensions (Supabase dashboard → Database → Extensions).
-- Replace <APP_URL> with your deployed app URL (e.g. https://your-app.vercel.app).
-- The runner endpoint is /api/ai-manager/autonomous and is authenticated with
-- the SUPABASE_SERVICE_ROLE_KEY passed as the x-service-role header.
-- ============================================================================

-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- -- Every day at 09:00 IST (03:30 UTC): morning optimization routine
-- select cron.schedule(
--   'ai-morning-optimization',
--   '30 3 * * *',
--   $$ select net.http_request(
--     url := 'https://<APP_URL>/api/ai-manager/autonomous',
--     method := 'POST',
--     headers := '{"Content-Type":"application/json","x-service-role":"<SUPABASE_SERVICE_ROLE_KEY>"}'::jsonb,
--     body := '{"routine":"morning_optimization"}'::jsonb
--   ); $$
-- );
--
-- -- Every hour: budget pacing + anomaly check
-- select cron.schedule(
--   'ai-hourly-pacing',
--   '0 * * * *',
--   $$ select net.http_request(
--     url := 'https://<APP_URL>/api/ai-manager/autonomous',
--     method := 'POST',
--     headers := '{"Content-Type":"application/json","x-service-role":"<SUPABASE_SERVICE_ROLE_KEY>"}'::jsonb,
--     body := '{"routine":"budget_pacing"}'::jsonb
--   ); $$
-- );
--
-- -- Every Monday 10:00 IST (04:30 UTC): weekly report
-- select cron.schedule(
--   'ai-weekly-report',
--   '30 4 * * 1',
--   $$ select net.http_request(
--     url := 'https://<APP_URL>/api/ai-manager/autonomous',
--     method := 'POST',
--     headers := '{"Content-Type":"application/json","x-service-role":"<SUPABASE_SERVICE_ROLE_KEY>"}'::jsonb,
--     body := '{"routine":"weekly_report"}'::jsonb
--   ); $$
-- );

-- ============================================================================
-- LEARNING UPGRADE 1: embed manager_memory for semantic recall
-- ============================================================================
-- Add an embedding column to manager_memory so the mastermind can recall
-- RELEVANT past learnings (not just the newest ones). Reuses the pgvector
-- extension already enabled above.
alter table public.manager_memory add column if not exists embedding vector(1536);

create index if not exists manager_memory_embedding_idx
  on public.manager_memory using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Semantic recall of the user's own memories. SECURITY DEFINER so the anon
-- key (RLS) can read it; it still restricts to the requesting user via p_user_id.
create or replace function public.match_memory(
  p_user_id uuid,
  p_embedding vector(1536),
  p_match_count int default 6,
  p_match_threshold float default 0.6
)
returns table (id text, kind text, content text, related_id text, importance int, similarity float)
language sql security definer stable
as $$
  select
    m.id, m.kind, m.content, m.related_id, m.importance,
    1 - (m.embedding <=> p_embedding) as similarity
  from public.manager_memory m
  where m.user_id = p_user_id
    and m.embedding is not null
    and 1 - (m.embedding <=> p_embedding) > p_match_threshold
  order by m.embedding <=> p_embedding
  limit p_match_count;
$$;

-- ============================================================================
-- LEARNING UPGRADE 2: reflection support
-- Returns the recent action log for the current user for the reflection routine.
-- ============================================================================
create or replace function public.recent_actions(p_user_id uuid, p_limit int default 50)
returns table (id text, tool_name text, arguments text, result text, status text, actor text, created_at timestamptz)
language sql security definer stable
as $$
  select id, tool_name, arguments, result, status, actor, created_at
  from public.ai_actions
  where user_id = p_user_id
  order by created_at desc
  limit p_limit;
$$;

-- ============================================================================
-- LEARNING UPGRADE 3: Supabase Vault for encrypted secrets
-- Moves API keys / Meta tokens out of plaintext columns into encrypted Vault
-- secrets. The app reads them via get_user_secret (SECURITY DEFINER, restricted
-- to the current user) so the RLS client can fetch its own secret.
-- Requires the Vault extension (Supabase dashboard → Extensions → enable Vault).
-- ============================================================================
create extension if not exists supabase_vault;
create extension if not exists pgcrypto;

-- Returns the decrypted secret value for the current authenticated user.
-- Secret names follow the convention: <userId>__<keyName>  e.g. <uuid>__openai_key
create or replace function public.get_user_secret(p_key text)
returns text
language sql security definer stable
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = auth.uid()::text || '__' || p_key
  limit 1;
$$;

-- Upsert a user's secret (create or update). Called with the service role,
-- or by the owning authenticated user. Rejects cross-user writes.
create or replace function public.set_user_secret(p_user_id uuid, p_key text, p_secret text, p_description text default '')
returns void
language plpgsql security definer
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role'
     and auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized to modify secrets for this user';
  end if;

  delete from vault.secrets where name = p_user_id::text || '__' || p_key;
  perform vault.create_secret(p_secret, p_user_id::text || '__' || p_key, coalesce(p_description, p_key));
end;
$$;

-- List a user's secret names (not values) for diagnostics.
create or replace function public.list_user_secrets(p_user_id uuid)
returns table (name text, description text, created_at timestamptz)
language sql security definer stable
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role'
     and auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized to list secrets for this user';
  end if;

  return query
  select s.name, s.description, s.created_at
  from vault.secrets s
  where s.name like p_user_id::text || '__%';
end;
$$;
