-- =====================================================================
-- NMRE · Schede Subito «novità non dimostrata»: nessuna notifica per scheda
-- =====================================================================
-- STATO: NON APPLICATA. Da applicare solo dopo approvazione, dal SQL Editor,
-- solo questo file, PRIMA di attivare NMRE_SUBITO_ITEM_CANDIDATES=true sulla
-- funzione nmre-gmail-scheduled.
-- Rollback: supabase/rollback/20261126210000_quiet_unproven_subito_candidates.rollback.sql
-- Test:     supabase/tests/run_migration_tests.sh (database locale usa e getta)
--
-- Contesto: quando la novità degli annunci di un'email Subito di ricerca salvata
-- non è dimostrabile, la sincronizzazione (con NMRE_SUBITO_ITEM_CANDIDATES=true)
-- crea una scheda «Da verificare» per OGNI annuncio plausibile, con
-- dati_estratti.subito.novita_non_dimostrata = true. Il trigger dei nuovi
-- candidati invierebbe una notifica push per ciascuna scheda (fino a 30 per
-- email). Con questa migrazione quelle schede non generano notifiche: resta la
-- notifica della scheda riepilogativa dell'email (una per email).
--
-- Scelta progettuale (come 20261126004257): la funzione del trigger NON viene
-- riscritta. Si estende solo la condizione WHEN già protetta per le agenzie:
--   WHEN (new.tipo_venditore IS DISTINCT FROM 'Agenzia'
--         AND coalesce(new.dati_estratti #>> '{subito,novita_non_dimostrata}', 'false') <> 'true')
-- Per tutti gli altri candidati il comportamento resta identico.
--
-- Sicurezze: definizione attuale salvata in private.nmre_trigger_definition_backups
-- con il nome interno '20261126210000_quiet_unproven_subito_candidates'; si
-- interrompe senza modifiche se il trigger non è nella forma protetta attesa;
-- idempotente; stato di abilitazione conservato.
-- =====================================================================

do $migration$
declare
  v_migration constant text := '20261126210000_quiet_unproven_subito_candidates';
  v_function regprocedure := to_regprocedure('private.nmre_notify_candidate_insert()');
  v_table regclass := to_regclass('public.annunci_candidati');
  v_count integer;
  v_trigger record;
  v_definition text;
begin
  if v_function is null or v_table is null then
    raise exception 'Funzione o tabella dei nuovi candidati non trovata: nessuna modifica eseguita';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'annunci_candidati'
                    and column_name = 'dati_estratti' and data_type = 'jsonb') then
    raise exception 'Colonna jsonb public.annunci_candidati.dati_estratti non trovata: nessuna modifica eseguita';
  end if;
  if to_regclass('private.nmre_trigger_definition_backups') is null then
    raise exception 'Tabella dei backup assente: applicare prima 20261126004257. Nessuna modifica eseguita';
  end if;

  select count(*) into v_count
    from pg_trigger t
   where t.tgrelid = v_table and t.tgfoid = v_function and not t.tgisinternal;
  if v_count <> 1 then
    raise exception 'Attesi un solo trigger che usa private.nmre_notify_candidate_insert(), trovati %: nessuna modifica eseguita', v_count;
  end if;

  select t.oid, t.tgname, t.tgtype, t.tgnargs, t.tgqual, t.tgenabled
    into v_trigger
    from pg_trigger t
   where t.tgrelid = v_table and t.tgfoid = v_function and not t.tgisinternal;
  v_definition := pg_get_triggerdef(v_trigger.oid);

  if v_definition ilike '%novita_non_dimostrata%' then
    raise notice 'Trigger % già escluso per le schede con novità non dimostrata: nessuna modifica', v_trigger.tgname;
    return;
  end if;

  -- Deve essere esattamente la forma protetta da 20261126004257.
  if (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) <> 0 or (v_trigger.tgtype & 64) <> 0
     or (v_trigger.tgtype & 4) = 0 or (v_trigger.tgtype & (8 | 16 | 32)) <> 0
     or v_trigger.tgnargs <> 0 or v_trigger.tgqual is null
     or v_definition !~* 'WHEN \(\(new\.tipo_venditore IS DISTINCT FROM ''Agenzia''::text\)\) EXECUTE FUNCTION' then
    raise exception 'Forma del trigger inattesa (attesa la protezione delle agenzie di 20261126004257): %. Nessuna modifica eseguita', v_definition;
  end if;

  insert into private.nmre_trigger_definition_backups
    (migration, table_name, trigger_name, original_definition, original_enabled)
  values (v_migration, 'public.annunci_candidati', v_trigger.tgname, v_definition, v_trigger.tgenabled)
  on conflict (migration, table_name, trigger_name) do nothing;

  execute format('drop trigger %I on public.annunci_candidati', v_trigger.tgname);
  execute format(
    'create trigger %I after insert on public.annunci_candidati for each row '
    'when (new.tipo_venditore is distinct from %L '
    'and coalesce(new.dati_estratti #>> %L, %L) <> %L) '
    'execute function private.nmre_notify_candidate_insert()',
    v_trigger.tgname, 'Agenzia', '{subito,novita_non_dimostrata}', 'false', 'true');

  if v_trigger.tgenabled = 'D' then
    execute format('alter table public.annunci_candidati disable trigger %I', v_trigger.tgname);
  elsif v_trigger.tgenabled = 'A' then
    execute format('alter table public.annunci_candidati enable always trigger %I', v_trigger.tgname);
  elsif v_trigger.tgenabled = 'R' then
    execute format('alter table public.annunci_candidati enable replica trigger %I', v_trigger.tgname);
  end if;

  if pg_get_triggerdef((select oid from pg_trigger where tgrelid = v_table and tgname = v_trigger.tgname)) not ilike '%novita_non_dimostrata%' then
    raise exception 'Verifica finale non superata: condizione non applicata';
  end if;
  raise notice 'Trigger % aggiornato: le schede Subito con novità non dimostrata non generano notifiche', v_trigger.tgname;
end;
$migration$;
