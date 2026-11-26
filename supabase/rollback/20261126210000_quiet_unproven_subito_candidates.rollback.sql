-- =====================================================================
-- ROLLBACK di 20261126210000_quiet_unproven_subito_candidates
-- =====================================================================
-- Ripristina la definizione del trigger salvata dalla migrazione (protezione delle
-- sole agenzie) e il suo stato di abilitazione. Non elimina dati; il backup resta.
-- Prima del rollback disattivare NMRE_SUBITO_ITEM_CANDIDATES, altrimenti ogni
-- scheda con novità non dimostrata tornerebbe a generare una notifica.
-- =====================================================================
do $rollback$
declare
  v_backup record;
begin
  select * into v_backup
    from private.nmre_trigger_definition_backups
   where migration = '20261126210000_quiet_unproven_subito_candidates'
     and table_name = 'public.annunci_candidati'
   order by saved_at desc
   limit 1;
  if not found then
    raise exception 'Backup della definizione non trovato: rollback non eseguito';
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
  raise notice 'Trigger % ripristinato (protezione delle sole agenzie)', v_backup.trigger_name;
end;
$rollback$;
