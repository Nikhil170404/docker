-- DocKaro schema.
--
-- Run against a Supabase project:
--   supabase db push
-- or paste into the SQL editor. Everything is idempotent so re-running is safe.
--
-- Row Level Security is on for every table. The app talks to Postgres two
-- ways and they are deliberately different:
--
--   * The browser, with the anon key and the user's JWT. RLS is the only
--     thing standing between one customer and another's data, so every
--     policy below is written as if the client is hostile — because it is
--     reachable by anyone with the anon key, which is public by design.
--   * The server, with the service-role key, which bypasses RLS. That key
--     never reaches the browser and is used for the things a user must not
--     be able to do themselves: mint an API key hash, mark an order paid,
--     grant a subscription.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- documents

create table if not exists public.documents (
  -- Chosen by the host for embeds, so it is text rather than a uuid.
  id            text primary key,
  owner_id      uuid references auth.users (id) on delete cascade,
  type          text not null default 'docx' check (type in ('docx', 'xlsx')),
  title         text not null default 'Untitled document',
  -- The editor's snapshot. Opaque to Postgres; only the editor reads it.
  content       jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Listing is always "my documents, newest first".
create index if not exists documents_owner_created_idx
  on public.documents (owner_id, created_at desc);

alter table public.documents enable row level security;

drop policy if exists documents_select_own on public.documents;
create policy documents_select_own on public.documents
  for select using (auth.uid() = owner_id);

drop policy if exists documents_insert_own on public.documents;
create policy documents_insert_own on public.documents
  for insert with check (auth.uid() = owner_id);

drop policy if exists documents_update_own on public.documents;
create policy documents_update_own on public.documents
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists documents_delete_own on public.documents;
create policy documents_delete_own on public.documents
  for delete using (auth.uid() = owner_id);

-- Anonymous documents (owner_id null) are reachable only through the server,
-- which uses the service-role key. No policy grants access to them, which is
-- the intent: an unowned document is addressed by an unguessable id, not by
-- a session, and RLS must not turn that into "anyone signed in can read it".

-- ---------------------------------------------------------------- api keys

create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  -- SHA-256 of the secret. The secret itself is shown once and never stored:
  -- a leaked database must not be a leaked set of live credentials.
  key_hash      text not null unique,
  -- Enough to recognise a key in a list without being enough to use it.
  key_prefix    text not null,
  last_four     text not null,
  name          text not null default 'Default key',
  plan_id       text not null default 'embed-free',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- Every API request looks a key up by its hash, so that lookup is the one
-- that must never degrade into a scan.
create unique index if not exists api_keys_hash_idx on public.api_keys (key_hash);
create index if not exists api_keys_owner_idx on public.api_keys (owner_id, created_at desc);

alter table public.api_keys enable row level security;

-- A user may see their own keys (prefix and last four only matter; the hash
-- is useless without the secret) and revoke them. Creating a key goes through
-- the server so the hash is computed somewhere the user cannot influence.
drop policy if exists api_keys_select_own on public.api_keys;
create policy api_keys_select_own on public.api_keys
  for select using (auth.uid() = owner_id);

drop policy if exists api_keys_revoke_own on public.api_keys;
create policy api_keys_revoke_own on public.api_keys
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------- billing

create table if not exists public.orders (
  order_id      text primary key,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  plan_id       text not null,
  currency      text not null check (currency in ('inr', 'usd')),
  period        text not null check (period in ('monthly', 'yearly')),
  seats         integer not null default 1 check (seats >= 1),
  -- Smallest currency unit, exactly as sent to Razorpay.
  amount_minor  integer not null check (amount_minor > 0),
  status        text not null default 'created' check (status in ('created', 'paid', 'failed')),
  payment_id    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists orders_owner_created_idx
  on public.orders (owner_id, created_at desc);

alter table public.orders enable row level security;

-- Read-only to the customer. Nothing in the browser may write an order:
-- status is decided by a signed webhook, not by whoever is looking at it.
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select using (auth.uid() = owner_id);

create table if not exists public.subscriptions (
  owner_id      uuid primary key references auth.users (id) on delete cascade,
  plan_id       text not null,
  currency      text not null check (currency in ('inr', 'usd')),
  period        text not null check (period in ('monthly', 'yearly')),
  seats         integer not null default 1 check (seats >= 1),
  started_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_order_id text
);

alter table public.subscriptions enable row level security;

-- Same reasoning: a customer may read their subscription and may not grant
-- themselves one.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = owner_id);

-- ---------------------------------------------------------------- usage

-- Editor loads, counted per key per calendar month. A row per month rather
-- than per request: the number that matters is the running total, and one
-- row per editor load would be millions of rows to answer a question that an
-- integer already answers.
create table if not exists public.usage_counters (
  key_hash      text not null,
  -- First day of the UTC month this row counts.
  period_start  date not null,
  loads         bigint not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (key_hash, period_start)
);

alter table public.usage_counters enable row level security;
-- No policies at all: usage is written by the server on every metered request
-- and read back through it. Nothing in the browser has any business here.

-- Atomic increment. Doing this as read-modify-write from the app would lose
-- counts under concurrency, and undercounting usage is undercharging.
create or replace function public.increment_usage(p_key_hash text, p_period date)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total bigint;
begin
  insert into public.usage_counters (key_hash, period_start, loads)
  values (p_key_hash, p_period, 1)
  on conflict (key_hash, period_start)
  do update set loads = public.usage_counters.loads + 1, updated_at = now()
  returning loads into new_total;

  return new_total;
end;
$$;

-- ---------------------------------------------------------------- updated_at

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_touch on public.documents;
create trigger documents_touch before update on public.documents
  for each row execute function public.touch_updated_at();

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();
