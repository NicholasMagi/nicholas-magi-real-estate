create table if not exists private.gmail_sync_lock (
  id boolean primary key default true check (id is true),
  lock_token uuid not null,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.gmail_push_watch_state (
  id boolean primary key default true check (id is true),
  history_id text not null check (history_id ~ '^[0-9]{1,30}$'),
  expiration timestamptz not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.gmail_sync_lock from public, anon, authenticated, service_role;
revoke all on table private.gmail_push_watch_state from public, anon, authenticated, service_role;

create or replace function public.nmre_try_acquire_gmail_sync_lock(
  p_lock_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if p_lock_token is null then
    raise exception 'Lock token required';
  end if;

  insert into private.gmail_sync_lock (id, lock_token, locked_until, updated_at)
  values (
    true,
    p_lock_token,
    clock_timestamp() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 600))),
    clock_timestamp()
  )
  on conflict (id) do update
    set lock_token = excluded.lock_token,
        locked_until = excluded.locked_until,
        updated_at = clock_timestamp()
    where private.gmail_sync_lock.locked_until <= clock_timestamp();

  return found;
end;
$$;

create or replace function public.nmre_release_gmail_sync_lock(p_lock_token uuid)
returns void
language sql
security definer
set search_path = pg_catalog, private
as $$
  delete from private.gmail_sync_lock
   where id is true
     and lock_token = p_lock_token;
$$;

create or replace function public.nmre_get_gmail_push_watch_state()
returns table(history_id text, expiration timestamptz)
language sql
security definer
set search_path = pg_catalog, private
as $$
  select state.history_id, state.expiration
    from private.gmail_push_watch_state as state
   where state.id is true
   limit 1;
$$;

create or replace function public.nmre_save_gmail_push_watch_state(
  p_history_id text,
  p_expiration timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if p_history_id is null
     or p_history_id !~ '^[0-9]{1,30}$'
     or p_expiration is null
     or p_expiration <= clock_timestamp()
     or p_expiration > clock_timestamp() + interval '8 days'
  then
    raise exception 'Invalid Gmail Push watch state';
  end if;

  insert into private.gmail_push_watch_state (id, history_id, expiration, updated_at)
  values (true, p_history_id, p_expiration, clock_timestamp())
  on conflict (id) do update
    set history_id = excluded.history_id,
        expiration = excluded.expiration,
        updated_at = clock_timestamp();
end;
$$;

revoke all on function public.nmre_try_acquire_gmail_sync_lock(uuid, integer) from public, anon, authenticated;
revoke all on function public.nmre_release_gmail_sync_lock(uuid) from public, anon, authenticated;
revoke all on function public.nmre_get_gmail_push_watch_state() from public, anon, authenticated;
revoke all on function public.nmre_save_gmail_push_watch_state(text, timestamptz) from public, anon, authenticated;

grant execute on function public.nmre_try_acquire_gmail_sync_lock(uuid, integer) to service_role;
grant execute on function public.nmre_release_gmail_sync_lock(uuid) to service_role;
grant execute on function public.nmre_get_gmail_push_watch_state() to service_role;
grant execute on function public.nmre_save_gmail_push_watch_state(text, timestamptz) to service_role;
