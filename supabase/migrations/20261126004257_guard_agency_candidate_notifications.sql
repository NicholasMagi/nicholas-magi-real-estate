-- =====================================================================
-- NMRE · Fase 1 · Nessuna notifica "nuove opportunità" per le agenzie
-- =====================================================================
-- STATO: NON APPLICATA IN PRODUZIONE. Da applicare solo dopo approvazione.
-- Rollback: supabase/rollback/20261125200000_guard_agency_candidate_notifications.rollback.sql
-- Test:     supabase/tests/run_migration_tests.sh (database locale usa e getta)
--
-- Contesto (AQ12, verificato in produzione il 25/11/2026): il trigger che usa
-- private.nmre_notify_candidate_insert() inserisce una notifica
-- new_opportunities per ogni candidato inserito con stato da_verificare, senza
-- controllare tipo_venditore. Con la Fase 1 le agenzie vengono conservate come
-- candidati e genererebbero notifiche indesiderate.
--
-- Scelta progettuale: la funzione del trigger NON viene riscritta (il suo codice
-- non è nel repository e non va ricostruito a memoria). Si aggiunge soltanto una
-- condizione WHEN al trigger esistente:
--     WHEN (new.tipo_venditore is distinct from 'Agenzia')
-- così la funzione non viene neppure chiamata per le agenzie, mentre per tutti
-- gli altri candidati (Privato, Da verificare, NULL) il comportamento resta
-- identico.
--
-- Sicurezze:
--  * la definizione originale del trigger viene salvata in
--    private.nmre_trigger_definition_backups prima di qualsiasi modifica;
--  * la migrazione si interrompe senza modificare nulla se il trigger non ha la
--    forma attesa (AFTER INSERT FOR EACH ROW, senza argomenti né WHEN), se non
--    esiste o se ce n'è più di uno;
--  * è idempotente: se il trigger è già protetto, non fa nulla;
--  * conserva lo stato di abilitazione del trigger (attivo/disattivo/replica).
-- =====================================================================

do $migration$
declare
  v_migration constant text := '20261125200000_guard_agency_candidate_notifications';
  v_function regprocedure := to_regprocedure('private.nmre_notify_candidate_insert()');
  v_table regclass := to_regclass('public.annunci_candidati');
  v_count integer;
  v_trigger record;
  v_definition text;
begin
  if v_function is null then
    raise exception 'Funzione private.nmre_notify_candidate_insert() non trovata: nessuna modifica eseguita';
  end if;
  if v_table is null then
    raise exception 'Tabella public.annunci_candidati non trovata: nessuna modifica eseguita';
  end if;

  select count(*) into v_count
    from pg_trigger t
   where t.tgrelid = v_table and t.tgfoid = v_function and not t.tgisinternal;
  if v_count = 0 then
    raise exception 'Nessun trigger di public.annunci_candidati usa private.nmre_notify_candidate_insert(): nessuna modifica eseguita';
  end if;
  if v_count > 1 then
    raise exception 'Trovati % trigger che usano la funzione: verifica manuale necessaria, nessuna modifica eseguita', v_count;
  end if;

  select t.oid, t.tgname, t.tgtype, t.tgnargs, t.tgqual, t.tgenabled
    into v_trigger
    from pg_trigger t
   where t.tgrelid = v_table and t.tgfoid = v_function and not t.tgisinternal;
  v_definition := pg_get_triggerdef(v_trigger.oid);

  -- Già protetto da questa migrazione: nulla da fare.
  if v_trigger.tgqual is not null and v_definition ilike '%tipo_venditore%IS DISTINCT FROM%Agenzia%' then
    raise notice 'Trigger % già protetto: nessuna modifica', v_trigger.tgname;
    return;
  end if;

  -- tgtype: 1 = FOR EACH ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE,
  -- 32 = TRUNCATE, 64 = INSTEAD OF. Atteso: AFTER INSERT FOR EACH ROW.
  if (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) <> 0 or (v_trigger.tgtype & 64) <> 0
     or (v_trigger.tgtype & 4) = 0 or (v_trigger.tgtype & (8 | 16 | 32)) <> 0
     or v_trigger.tgnargs <> 0 or v_trigger.tgqual is not null then
    raise exception 'Forma del trigger inattesa (atteso AFTER INSERT FOR EACH ROW senza WHEN né argomenti): %. Nessuna modifica eseguita', v_definition;
  end if;

  -- Oggetti di supporto creati solo dopo i controlli, nello stesso blocco
  -- atomico: se un controllo fallisce non resta nulla.
  execute $ddl$
    create table if not exists private.nmre_trigger_definition_backups (
      id bigint generated always as identity primary key,
      migration text not null,
      table_name text not null,
      trigger_name text not null,
      original_definition text not null,
      original_enabled "char" not null,
      saved_at timestamptz not null default now(),
      unique (migration, table_name, trigger_name)
    )
  $ddl$;
  execute 'alter table private.nmre_trigger_definition_backups enable row level security';
  execute 'revoke all on table private.nmre_trigger_definition_backups from public, anon, authenticated';

  insert into private.nmre_trigger_definition_backups
    (migration, table_name, trigger_name, original_definition, original_enabled)
  values (v_migration, 'public.annunci_candidati', v_trigger.tgname, v_definition, v_trigger.tgenabled)
  on conflict (migration, table_name, trigger_name) do nothing;

  execute format('drop trigger %I on public.annunci_candidati', v_trigger.tgname);
  execute format(
    'create trigger %I after insert on public.annunci_candidati for each row '
    'when (new.tipo_venditore is distinct from %L) '
    'execute function private.nmre_notify_candidate_insert()',
    v_trigger.tgname, 'Agenzia');

  -- Ripristina lo stato di abilitazione originale (O = attivo, predefinito).
  if v_trigger.tgenabled = 'D' then
    execute format('alter table public.annunci_candidati disable trigger %I', v_trigger.tgname);
  elsif v_trigger.tgenabled = 'A' then
    execute format('alter table public.annunci_candidati enable always trigger %I', v_trigger.tgname);
  elsif v_trigger.tgenabled = 'R' then
    execute format('alter table public.annunci_candidati enable replica trigger %I', v_trigger.tgname);
  end if;

  raise notice 'Trigger % protetto: le agenzie non generano notifiche new_opportunities', v_trigger.tgname;
end;
$migration$;
