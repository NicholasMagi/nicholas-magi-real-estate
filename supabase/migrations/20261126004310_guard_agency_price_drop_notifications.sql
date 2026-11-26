-- =====================================================================
-- NMRE · Fase 1 · Nessuna notifica push di ribasso per le agenzie
-- =====================================================================
-- STATO: NON APPLICATA IN PRODUZIONE. Da applicare solo dopo approvazione,
-- DOPO 20261125200000_guard_agency_candidate_notifications.sql e PRIMA della
-- funzione nmre-gmail-scheduled di Fase 1.
-- Rollback: supabase/rollback/20261125202000_guard_agency_price_drop_notifications.rollback.sql
-- Test:     supabase/tests/run_migration_tests.sh (database locale usa e getta)
--
-- Contesto: oltre al trigger dei nuovi candidati, in produzione esiste un
-- trigger su public.annunci_candidati_notifiche che crea notifiche push di
-- ribasso (price_drop) quando una riga dello storico riporta un ribasso. La
-- funzione nmre-gmail-scheduled registra nello storico anche le notifiche delle
-- agenzie conservate: senza questa migrazione un'agenzia potrebbe generare una
-- push di ribasso.
--
-- Scelta progettuale:
--  * lo storico NON cambia: ogni riga, con prezzo e ribasso, continua a essere
--    salvata e mostrata nell'app;
--  * la funzione del trigger NON viene riscritta (il suo codice non è nel
--    repository): si aggiunge alla condizione del trigger esistente
--        NOT private.nmre_candidate_is_agency(new.candidate_id)
--    combinandola con l'eventuale condizione WHEN già presente;
--  * private.nmre_candidate_is_agency() è una funzione di sola lettura che
--    risponde TRUE solo se il candidato collegato ha tipo_venditore = 'Agenzia'.
--    Per Privato, Da verificare, tipo assente o candidato inesistente risponde
--    FALSE: il comportamento resta identico.
--
-- Individuazione del trigger: tra i trigger non interni di
-- public.annunci_candidati_notifiche si sceglie quello la cui funzione crea
-- notifiche (scrive in nmre_notifications). Se non ce n'è nessuno, o ce n'è più
-- di uno, o non è un trigger AFTER FOR EACH ROW su INSERT/UPDATE, la migrazione
-- si interrompe SENZA modificare nulla.
--
-- Sicurezze: definizione originale salvata in
-- private.nmre_trigger_definition_backups; idempotente; stato di abilitazione
-- conservato; verifica finale che la nuova definizione contenga sia la
-- condizione originale sia quella sulle agenzie.
-- =====================================================================

do $migration$
declare
  v_migration constant text := '20261125202000_guard_agency_price_drop_notifications';
  v_table regclass := to_regclass('public.annunci_candidati_notifiche');
  v_guard constant text := 'NOT private.nmre_candidate_is_agency(new.candidate_id)';
  v_count integer;
  v_trigger record;
  v_definition text;
  v_new_definition text;
  v_when_start integer;
  v_execute_start integer;
  v_condition text;
begin
  if v_table is null then
    raise exception 'Tabella public.annunci_candidati_notifiche non trovata: nessuna modifica eseguita';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = v_table and attname = 'candidate_id' and not attisdropped
  ) then
    raise exception 'Colonna candidate_id non trovata: nessuna modifica eseguita';
  end if;

  select count(*) into v_count
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = v_table and not t.tgisinternal
     and p.prosrc ~* 'nmre_notifications';
  if v_count = 0 then
    raise exception 'Nessun trigger di notifica su public.annunci_candidati_notifiche: nessuna modifica eseguita';
  end if;
  if v_count > 1 then
    raise exception 'Trovati % trigger di notifica su public.annunci_candidati_notifiche: verifica manuale necessaria, nessuna modifica eseguita', v_count;
  end if;

  select t.oid, t.tgname, t.tgtype, t.tgqual, t.tgenabled
    into v_trigger
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = v_table and not t.tgisinternal
     and p.prosrc ~* 'nmre_notifications';
  v_definition := pg_get_triggerdef(v_trigger.oid);

  -- Già protetto: nulla da fare.
  if position('nmre_candidate_is_agency' in v_definition) > 0 then
    raise notice 'Trigger % già protetto: nessuna modifica', v_trigger.tgname;
    return;
  end if;

  -- tgtype: 1 = FOR EACH ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE,
  -- 32 = TRUNCATE, 64 = INSTEAD OF. Ammesso: AFTER, FOR EACH ROW, INSERT e/o UPDATE.
  if (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) <> 0 or (v_trigger.tgtype & 64) <> 0
     or (v_trigger.tgtype & (8 | 32)) <> 0 or (v_trigger.tgtype & (4 | 16)) = 0 then
    raise exception 'Forma del trigger inattesa (atteso AFTER INSERT/UPDATE FOR EACH ROW): %. Nessuna modifica eseguita', v_definition;
  end if;

  -- pg_get_triggerdef produce una forma canonica:
  --   CREATE TRIGGER ... FOR EACH ROW [WHEN (<condizione>)] EXECUTE FUNCTION ...
  v_execute_start := position(' EXECUTE FUNCTION ' in v_definition);
  if v_execute_start = 0 then
    raise exception 'Definizione del trigger non riconosciuta: %. Nessuna modifica eseguita', v_definition;
  end if;
  if v_trigger.tgqual is null then
    v_new_definition := substr(v_definition, 1, v_execute_start - 1)
      || ' WHEN (' || v_guard || ')'
      || substr(v_definition, v_execute_start);
  else
    v_when_start := position(' WHEN (' in v_definition);
    if v_when_start = 0 or v_when_start > v_execute_start then
      raise exception 'Condizione WHEN non riconosciuta: %. Nessuna modifica eseguita', v_definition;
    end if;
    -- Testo tra "WHEN " e " EXECUTE FUNCTION": la condizione originale tra parentesi.
    v_condition := substr(v_definition, v_when_start + 6, v_execute_start - (v_when_start + 6));
    v_new_definition := substr(v_definition, 1, v_when_start - 1)
      || ' WHEN (' || v_condition || ' AND ' || v_guard || ')'
      || substr(v_definition, v_execute_start);
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
  -- Funzione di supporto: sola lettura, restituisce solo un booleano.
  execute $fn$
    create or replace function private.nmre_candidate_is_agency(p_candidate_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $body$
      select coalesce(
        (select c.tipo_venditore = 'Agenzia'
           from public.annunci_candidati c
          where c.id = p_candidate_id),
        false
      );
    $body$
  $fn$;
  execute 'revoke all on function private.nmre_candidate_is_agency(uuid) from public, anon';
  execute 'grant execute on function private.nmre_candidate_is_agency(uuid) to authenticated, service_role';

  insert into private.nmre_trigger_definition_backups
    (migration, table_name, trigger_name, original_definition, original_enabled)
  values (v_migration, 'public.annunci_candidati_notifiche', v_trigger.tgname, v_definition, v_trigger.tgenabled)
  on conflict (migration, table_name, trigger_name) do nothing;

  execute format('drop trigger %I on public.annunci_candidati_notifiche', v_trigger.tgname);
  execute v_new_definition;

  if v_trigger.tgenabled = 'D' then
    execute format('alter table public.annunci_candidati_notifiche disable trigger %I', v_trigger.tgname);
  elsif v_trigger.tgenabled = 'A' then
    execute format('alter table public.annunci_candidati_notifiche enable always trigger %I', v_trigger.tgname);
  elsif v_trigger.tgenabled = 'R' then
    execute format('alter table public.annunci_candidati_notifiche enable replica trigger %I', v_trigger.tgname);
  end if;

  -- Verifica finale: la nuova definizione contiene la protezione e, se c'era,
  -- la condizione originale.
  select pg_get_triggerdef(t.oid) into v_new_definition
    from pg_trigger t
   where t.tgrelid = v_table and t.tgname = v_trigger.tgname;
  if position('nmre_candidate_is_agency' in v_new_definition) = 0 then
    raise exception 'Verifica fallita: protezione assente nella nuova definizione. Nessuna modifica mantenuta';
  end if;

  raise notice 'Trigger % protetto: le agenzie non generano notifiche push di ribasso', v_trigger.tgname;
end;
$migration$;
