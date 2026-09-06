-- Migration 0003 — per-user business profile.
--
-- The platform is multi-tenant: any business signs up, brings its own Meta
-- app credentials, and gets campaigns and creatives in ITS language for ITS
-- market. Until now the language ("Marathi"), market ("Maharashtra"), script
-- ("Devanagari") and currency (₹) were hardcoded into every prompt — they were
-- the first customer's settings masquerading as product behaviour.
--
-- This table is the single source of truth the agent reads before it writes a
-- single line of ad copy. Idempotent; safe to re-run.

begin;

create table if not exists public.business_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- Who they are
  business_name text,
  website_url text,
  industry text,
  description text,
  products text,                 -- free text: what they sell, price points, offers
  usp text,                      -- what makes them different, in their words

  -- Language. BCP-47 code plus a human label the model can follow precisely,
  -- e.g. ('mr', 'Marathi (Devanagari script)') or ('en', 'English').
  primary_language text not null default 'en',
  primary_language_label text not null default 'English',
  secondary_languages text[] not null default '{}',
  -- 'mixed' lets the copy code-switch (Hinglish, Marathi + English), which is
  -- how a lot of Indian advertising actually reads.
  language_mode text not null default 'single'
    check (language_mode in ('single', 'mixed')),

  -- Market
  market_country text not null default 'IN',
  market_regions text[] not null default '{}',
  market_cities text[] not null default '{}',
  currency text not null default 'INR',

  -- Voice
  target_audience text,
  tone text,                     -- e.g. "warm, trustworthy, plain-spoken"
  brand_colors text[] not null default '{}',
  avoid text,                    -- things never to say or show

  -- Process
  default_objective text,        -- OUTCOME_SALES, OUTCOME_LEADS, ...
  default_cta text,              -- SHOP_NOW, LEARN_MORE, WHATSAPP_MESSAGE, ...
  landing_url text,
  cultural_notes text,           -- festivals, taboos, local idiom the copy should respect

  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_profiles enable row level security;

drop policy if exists business_profiles_owner on public.business_profiles;
create policy business_profiles_owner on public.business_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep updated_at honest.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists business_profiles_touch on public.business_profiles;
create trigger business_profiles_touch
  before update on public.business_profiles
  for each row execute function public.touch_updated_at();

-- Knowledge documents gain a URL so website pages can be re-crawled and
-- de-duplicated instead of ingested twice.
alter table public.knowledge_documents add column if not exists source_url text;
create index if not exists knowledge_documents_user_url_idx
  on public.knowledge_documents (user_id, source_url);

-- Creatives record the language they were written in, so a mixed-language
-- account can filter and so reviews judge copy against the right script.
alter table public.ad_creatives alter column language set default 'en';

commit;
