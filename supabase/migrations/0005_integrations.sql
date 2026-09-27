-- Migration 0005 — third-party connections (research, image/video, voice, custom MCP).
--
-- A business can plug extra capability into its agents, either by API key or
-- by pointing at an MCP server. The secret (API key, MCP bearer) never lives in
-- this table: it is stored in Vault under "<user>__integration_<slug>" and the
-- column holds only the sentinel. Idempotent; safe to re-run.

begin;

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Catalog id ("tavily", "fal") or "custom-<name>" for a custom MCP server.
  slug text not null,
  provider text not null,
  mode text not null check (mode in ('api_key', 'mcp')),
  label text,
  -- Non-secret settings only: custom MCP URL, header name, preferences.
  config jsonb not null default '{}'::jsonb,
  secret text,
  status text not null default 'untested' check (status in ('connected', 'error', 'untested')),
  last_tested_at timestamptz,
  last_error text,
  -- MCP tools discovered at test time: [{ name, description, required[] }].
  tools jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists integrations_user_idx on public.integrations (user_id);

alter table public.integrations enable row level security;

drop policy if exists integrations_owner on public.integrations;
create policy integrations_owner on public.integrations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists integrations_touch on public.integrations;
create trigger integrations_touch
  before update on public.integrations
  for each row execute function public.touch_updated_at();

-- Tables created over the direct connection do not always inherit Supabase's
-- default grants. Grant explicitly; RLS above still scopes rows to the owner.
grant select, insert, update, delete on public.integrations to authenticated;
grant all on public.integrations to service_role;

commit;
