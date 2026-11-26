-- =====================================================================
-- ROLLBACK di 20261125202000_guard_agency_price_drop_notifications
-- =====================================================================
-- Ripristina ESATTAMENTE la definizione originale del trigger di notifica su
-- public.annunci_candidati_notifiche (salvata dalla migrazione) e il suo stato
-- di abilitazione, poi rimuove la funzione di supporto non più usata.
-- Non elimina dati: lo storico notifiche e la tabella di backup restano.
-- Si interrompe senza modifiche se il backup non esiste.
-- =====================================================================
do $rollback$
declare
  v_backup record;
begin
  select * into v_backup
    from private.nmre_trigger_definition_backups
   where migration = '20261125202000_guard_agency_price_drop_notifications'
     and table_name = 'public.annunci_candidati_notifiche'
   order by saved_at desc
   limit 1;
  if not found then
    raise exception 'Backup della definizione originale non trovato: rollback non eseguito';
  end if;

  execute format('drop trigger if exists %I on public.annunci_candidati_notifiche', v_backup.trigger_name);
  execute v_backup.original_definition;

  if v_backup.original_enabled = 'D' then
    execute format('alter table public.annunci_candidati_notifiche disable trigger %I', v_backup.trigger_name);
  elsif v_backup.original_enabled = 'A' then
    execute format('alter table public.annunci_candidati_notifiche enable always trigger %I', v_backup.trigger_name);
  elsif v_backup.original_enabled = 'R' then
    execute format('alter table public.annunci_candidati_notifiche enable replica trigger %I', v_backup.trigger_name);
  end if;

  -- La funzione di supporto è rimossa solo se nessun altro trigger la usa.
  if not exists (
    select 1 from pg_trigger t
     where not t.tgisinternal and pg_get_triggerdef(t.oid) like '%nmre_candidate_is_agency%'
  ) then
    drop function if exists private.nmre_candidate_is_agency(uuid);
  end if;

  raise notice 'Trigger % ripristinato alla definizione originale', v_backup.trigger_name;
end;
$rollback$;
