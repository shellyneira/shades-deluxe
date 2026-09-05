-- Shades Deluxe — cloud storage + login.
-- Run this once: Dashboard → SQL Editor → New query → paste → Run.
-- Company info, rates and other single-admin settings live in one shared row
-- (app_state). Quotes, price tables and lists are each their own rows so two
-- people editing different things never clobber each other's work.
-- Only logged-in users can read/write (login-only; sign-ups are disabled in Auth settings).

create table if not exists app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists quotes (
  id text primary key,
  number int,
  client_name text,
  status text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists price_tables (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists option_lists (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;
alter table quotes enable row level security;
alter table price_tables enable row level security;
alter table option_lists enable row level security;

drop policy if exists "authed read"   on app_state;
drop policy if exists "authed insert" on app_state;
drop policy if exists "authed update" on app_state;
create policy "authed read"   on app_state for select to authenticated using (true);
create policy "authed insert" on app_state for insert to authenticated with check (true);
create policy "authed update" on app_state for update to authenticated using (true) with check (true);

drop policy if exists "authed read"   on quotes;
drop policy if exists "authed insert" on quotes;
drop policy if exists "authed update" on quotes;
drop policy if exists "authed delete" on quotes;
create policy "authed read"   on quotes for select to authenticated using (true);
create policy "authed insert" on quotes for insert to authenticated with check (true);
create policy "authed update" on quotes for update to authenticated using (true) with check (true);
create policy "authed delete" on quotes for delete to authenticated using (true);

drop policy if exists "authed read"   on price_tables;
drop policy if exists "authed insert" on price_tables;
drop policy if exists "authed update" on price_tables;
drop policy if exists "authed delete" on price_tables;
create policy "authed read"   on price_tables for select to authenticated using (true);
create policy "authed insert" on price_tables for insert to authenticated with check (true);
create policy "authed update" on price_tables for update to authenticated using (true) with check (true);
create policy "authed delete" on price_tables for delete to authenticated using (true);

drop policy if exists "authed read"   on option_lists;
drop policy if exists "authed insert" on option_lists;
drop policy if exists "authed update" on option_lists;
drop policy if exists "authed delete" on option_lists;
create policy "authed read"   on option_lists for select to authenticated using (true);
create policy "authed insert" on option_lists for insert to authenticated with check (true);
create policy "authed update" on option_lists for update to authenticated using (true) with check (true);
create policy "authed delete" on option_lists for delete to authenticated using (true);
