-- Migration 0006 — close cross-tenant access through SECURITY DEFINER functions.
--
-- These functions run with the owner's rights, so they bypass row-level
-- security, and several take the user id as an argument without checking who
-- is asking. Supabase grants EXECUTE on public functions to `anon` by default,
-- so anyone holding the public anon key (it ships to every browser) could read
-- another business's action log, memory, knowledge base or strategy, bump
-- their rate limits, insert messages, or rewrite owner policies on any table.
--
-- Fix: every function that takes a user id now answers only for that user or
-- for the service role, and nothing here is executable by `anon`. Readers
-- return no rows for a caller who is not allowed (the same shape RLS gives);
-- writers raise. Idempotent; safe to re-run.

begin;

-- True when the caller is the service role, or is signed in as p_user_id.
create or replace function public.caller_may_act_for(p_user_id uuid)
returns boolean
language sql stable
set search_path = public
as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
      or auth.uid() = p_user_id;
$$;

-- ── Readers ─────────────────────────────────────────────────────────────

create or replace function public.recent_actions(p_user_id uuid, p_limit int default 50)
returns table (id text, tool_name text, arguments text, result text, status text, actor text, created_at timestamptz)
language sql security definer stable
set search_path = public
as $$
  select id, tool_name, arguments, result, status, actor, created_at
  from public.ai_actions
  where user_id = p_user_id
    and public.caller_may_act_for(p_user_id)
  order by created_at desc
  limit p_limit;
$$;

create or replace function public.match_memory(
  p_user_id uuid,
  p_embedding vector(1536),
  p_match_count int default 6,
  p_match_threshold float default 0.6
)
returns table (id text, kind text, content text, related_id text, importance int, similarity float)
language sql security definer stable
set search_path = public, extensions
as $$
  select
    m.id, m.kind, m.content, m.related_id, m.importance,
    1 - (m.embedding <=> p_embedding) as similarity
  from public.manager_memory m
  where m.user_id = p_user_id
    and public.caller_may_act_for(p_user_id)
    and m.embedding is not null
    and 1 - (m.embedding <=> p_embedding) > p_match_threshold
  order by m.embedding <=> p_embedding
  limit p_match_count;
$$;

create or replace function public.match_knowledge_chunks(
  p_user_id uuid,
  p_embedding vector(1536),
  p_match_count int default 5,
  p_match_threshold float default 0.7
)
returns table (id text, document_id text, content text, similarity float)
language sql security definer stable
set search_path = public, extensions
as $$
  select c.id, c.document_id, c.content, 1 - (c.embedding <=> p_embedding) as similarity
  from public.knowledge_chunks c
  where c.user_id = p_user_id
    and public.caller_may_act_for(p_user_id)
    and c.embedding is not null
    and 1 - (c.embedding <=> p_embedding) > p_match_threshold
  order by c.embedding <=> p_embedding
  limit p_match_count;
$$;

create or replace function public.get_account_strategy(p_user_id uuid)
returns public.account_strategy
language sql security definer stable
set search_path = public
as $$
  select * from public.account_strategy
  where user_id = p_user_id
    and public.caller_may_act_for(p_user_id)
  limit 1;
$$;

-- ── Writers ─────────────────────────────────────────────────────────────

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
  if not public.caller_may_act_for(p_user_id) then
    raise exception 'Not authorized to use the rate limit of this user';
  end if;

  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, p_window_start, 1)
  on conflict (user_id, bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return query select (v_count <= p_limit), v_count;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────

revoke all on function public.caller_may_act_for(uuid) from public, anon;
grant execute on function public.caller_may_act_for(uuid) to authenticated, service_role;

-- Guarded readers and the rate limiter: signed-in users (for their own id)
-- and the service role.
revoke all on function public.recent_actions(uuid, int) from public, anon;
revoke all on function public.match_memory(uuid, vector, int, float) from public, anon;
revoke all on function public.match_knowledge_chunks(uuid, vector, int, float) from public, anon;
revoke all on function public.get_account_strategy(uuid) from public, anon;
revoke all on function public.bump_rate_limit(uuid, text, timestamptz, int) from public, anon;
grant execute on function public.recent_actions(uuid, int) to authenticated, service_role;
grant execute on function public.match_memory(uuid, vector, int, float) to authenticated, service_role;
grant execute on function public.match_knowledge_chunks(uuid, vector, int, float) to authenticated, service_role;
grant execute on function public.get_account_strategy(uuid) to authenticated, service_role;
grant execute on function public.bump_rate_limit(uuid, text, timestamptz, int) to authenticated, service_role;

-- Server-only helpers: no browser session has any business calling these.
revoke all on function public.insert_agent_message(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.prune_rate_limits() from public, anon, authenticated;
revoke all on function public.apply_owner_policies(text) from public, anon, authenticated;
grant execute on function public.insert_agent_message(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.prune_rate_limits() to service_role;
grant execute on function public.apply_owner_policies(text) to service_role;

commit;
