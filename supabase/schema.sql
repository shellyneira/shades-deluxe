-- Shades Deluxe — cloud storage + login.
-- Run this once: Dashboard → SQL Editor → New query → paste → Run.
-- The whole app state (price tables, lists, company info, quotes/orders) lives in one row.
-- Only logged-in users can read/write (login-only; sign-ups are disabled in Auth settings).

create table if not exists app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

drop policy if exists "authed read"   on app_state;
drop policy if exists "authed insert" on app_state;
drop policy if exists "authed update" on app_state;

create policy "authed read"   on app_state for select to authenticated using (true);
create policy "authed insert" on app_state for insert to authenticated with check (true);
create policy "authed update" on app_state for update to authenticated using (true) with check (true);
