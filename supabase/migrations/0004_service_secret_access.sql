-- Migration 0004 — let server-side jobs read a named user's secrets.
--
-- get_user_secret(p_key) resolves the owner from auth.uid(), which only exists
-- when a browser session is attached. Vercel Cron, the n8n heartbeat and every
-- other autonomous run have no session, so they got NULL back and called Meta
-- with no token ("Cannot parse access token"). These two functions take the
-- user id explicitly and are executable by the service role ONLY.
--
-- clearUserSecret() previously deleted through PostgREST on "vault.secrets",
-- a schema PostgREST does not expose, so disconnecting never removed anything.
-- delete_user_secret fixes that. Idempotent; safe to re-run.

begin;

create or replace function public.get_user_secret_for(p_user_id uuid, p_key text)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_user_id::text || '__' || p_key
  limit 1;
$$;

create or replace function public.delete_user_secret(p_user_id uuid, p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where name = p_user_id::text || '__' || p_key;
$$;

revoke all on function public.get_user_secret_for(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_user_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.get_user_secret_for(uuid, text) to service_role;
grant execute on function public.delete_user_secret(uuid, text) to service_role;

commit;
