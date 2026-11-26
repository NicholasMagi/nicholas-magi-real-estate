-- =====================================================================
-- ROLLBACK di 20261125200000_guard_agency_candidate_notifications
-- =====================================================================
-- Ripristina ESATTAMENTE la definizione originale del trigger salvata dalla
-- migrazione (pg_get_triggerdef) e il suo stato di abilitazione.
-- Non elimina dati: la tabella di backup resta, per tracciabilità.
-- Si interrompe senza modifiche se il backup non esiste.
-- =====================================================================
do $rollback$
declare
  v_backup record;
begin
  select * into v_backup
    from private.nmre_trigger_definition_backups
   where migration = '20261125200000_guard_agency_candidate_notifications'
     and table_name = 'public.annunci_candidati'
   order by saved_at desc
   limit 1;
  if not found then
    raise exception 'Backup della definizione originale non trovato: rollback non eseguito';
  end if;

  execute format('drop trigger if exists %I on public.annunci_candidati', v_backup.trigger_name);
  execute v_backup.original_definition;

  if v_backup.original_enabled = 'D' then
    execute format('alter table public.annunci_candidati disable trigger %I', v_backup.trigger_name);
  elsif v_backup.original_enabled = 'A' then
    execute format('alter table public.annunci_candidati enable always trigger %I', v_backup.trigger_name);
  elsif v_backup.original_enabled = 'R' then
    execute format('alter table public.annunci_candidati enable replica trigger %I', v_backup.trigger_name);
  end if;

  raise notice 'Trigger % ripristinato alla definizione originale', v_backup.trigger_name;
end;
$rollback$;
