-- ---------------------------------------------------------------------------
-- Row versions. Every write bumps `rev` on the server, so every version of a row is
-- totally ordered and a client can tell a stale echo/poll from a newer row without
-- guessing (see js/sync.js). `op` is a per-write id the writer sets, so a client
-- recognises the echo of its OWN write by identity, not by comparing content.
-- Re-runnable. Safe to run before deploying the matching JS (old clients keep working).
-- ---------------------------------------------------------------------------

create or replace function public.bump_rev() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
  else
    new.rev := old.rev + 1;
    -- A writer that did not send a fresh op (an older cached client) must not leave a
    -- stale one behind for others to mistake for a new write.
    if new.op is not distinct from old.op then new.op := null; end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['app_state', 'quotes', 'price_tables', 'option_lists'] loop
    execute format('alter table public.%I add column if not exists rev bigint not null default 1', t);
    execute format('alter table public.%I add column if not exists op text', t);
    execute format('drop trigger if exists bump_rev on public.%I', t);
    execute format('create trigger bump_rev before insert or update on public.%I for each row execute function public.bump_rev()', t);
  end loop;
end $$;
