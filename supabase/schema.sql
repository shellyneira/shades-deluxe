-- Shades Deluxe — cloud storage.
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- The whole app state (price tables, lists, company info, quotes/orders) lives in one row.

create table if not exists app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

-- No login: the public "anon" key may read and write this single table.
-- (Fine for a private internal tool shared by link.)
drop policy if exists "anon read"   on app_state;
drop policy if exists "anon insert" on app_state;
drop policy if exists "anon update" on app_state;

create policy "anon read"   on app_state for select using (true);
create policy "anon insert" on app_state for insert with check (true);
create policy "anon update" on app_state for update using (true) with check (true);
