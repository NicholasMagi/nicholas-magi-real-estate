-- Incremental Gmail history cursor. OAuth tokens remain encrypted in the existing private table.
create table if not exists private.gmail_sync_state (
  id boolean primary key default true check (id is true),
  history_id text not null check (history_id ~ '^[0-9]{1,30}$'),
  updated_at timestamptz not null default now()
);

alter table private.gmail_sync_state enable row level security;
revoke all on table private.gmail_sync_state from public, anon, authenticated;
grant all on table private.gmail_sync_state to service_role;

create or replace function public.nmre_get_gmail_sync_state()
returns table(history_id text)
language sql
security definer
set search_path = ''
as $function$
  select state.history_id
  from private.gmail_sync_state as state
  where state.id is true
  limit 1;
$function$;

create or replace function public.nmre_save_gmail_sync_state(p_history_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_history_id is null or p_history_id !~ '^[0-9]{1,30}$' then
    raise exception 'Invalid Gmail history identifier';
  end if;

  insert into private.gmail_sync_state (id, history_id, updated_at)
  values (true, p_history_id, now())
  on conflict (id) do update
    set history_id = excluded.history_id,
        updated_at = now();
end;
$function$;

revoke all on function public.nmre_get_gmail_sync_state() from public, anon, authenticated;
grant execute on function public.nmre_get_gmail_sync_state() to service_role;

revoke all on function public.nmre_save_gmail_sync_state(text) from public, anon, authenticated;
grant execute on function public.nmre_save_gmail_sync_state(text) to service_role;

-- The confirmation RPC checks auth.uid() and candidate ownership. It is only needed by signed-in users.
revoke all on function public.nmre_confirm_annuncio_candidato(
  uuid, text, text, numeric, text, text, text, text, text, integer, numeric, integer, integer
) from public, anon;
grant execute on function public.nmre_confirm_annuncio_candidato(
  uuid, text, text, numeric, text, text, text, text, text, integer, numeric, integer, integer
) to authenticated, service_role;

comment on table private.gmail_sync_state is
  'Server-only Gmail history cursor for incremental synchronization; no message body or OAuth token is stored here.';