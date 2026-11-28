-- =====================================================================
-- NMRE · Lettura dei token Gmail eseguibile in sola lettura (STABLE)
-- =====================================================================
-- STATO: NON APPLICATA. Da applicare solo dopo approvazione, dal SQL Editor,
-- solo questo file. Rollback:
--   supabase/rollback/20261126200000_gmail_tokens_rpc_stable.rollback.sql
-- Test: supabase/tests/run_migration_tests.sh (database locale usa e getta).
--
-- Motivo: la prova senza scritture nmre-subito-dry-run chiama
-- public.nmre_get_gmail_tokens() in GET, perché PostgREST esegua la chiamata in
-- una transazione READ ONLY. La funzione è oggi VOLATILE (impostazione
-- predefinita), quindi la chiamata in GET non è accettata. Il corpo attuale
-- (verificato dal titolare) è una sola SELECT su private.gmail_oauth_tokens:
-- dichiararla STABLE ne descrive correttamente il comportamento.
--
-- Cosa cambia: SOLO la volatilità della funzione. Corpo, firma, SECURITY
-- DEFINER, search_path, proprietario e permessi restano invariati (verificato
-- dalla migrazione stessa con un'impronta prima e dopo). Nessun dato
-- viene letto o modificato. Gli altri chiamanti (nmre-gmail-scheduled e
-- nmre-gmail-oauth-callback) usano la funzione solo per leggere: nessun effetto.
--
-- Garanzie:
--  * si interrompe SENZA modificare nulla se la funzione non esiste, se esistono
--    più versioni con lo stesso nome, se non è in linguaggio SQL, se il corpo non
--    è una singola SELECT o se contiene istruzioni o funzioni di scrittura;
--  * è idempotente: se la funzione è già STABLE non fa nulla;
--  * una funzione SQL non VOLATILE non può eseguire INSERT/UPDATE/DELETE: Postgres
--    lo rifiuta. Insieme alla transazione READ ONLY di PostgREST per le chiamate in
--    GET, una scrittura futura nel corpo fallirebbe invece di scrivere.
-- =====================================================================

do $migration$
declare
  v_count integer;
  v_function record;
  v_body text;
  v_before text;
  v_after text;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nmre_get_gmail_tokens';
  if v_count <> 1 then
    raise exception 'Attese una sola funzione public.nmre_get_gmail_tokens, trovate %: nessuna modifica eseguita', v_count;
  end if;

  select p.oid, p.provolatile, p.prosecdef, l.lanname, p.prosrc, p.pronargs
    into v_function
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and p.proname = 'nmre_get_gmail_tokens';

  if v_function.provolatile = 's' then
    raise notice 'public.nmre_get_gmail_tokens() è già STABLE: nessuna modifica';
    return;
  end if;
  if v_function.provolatile <> 'v' then
    raise exception 'Volatilità inattesa (%): nessuna modifica eseguita', v_function.provolatile;
  end if;
  if v_function.pronargs <> 0 then
    raise exception 'La funzione ha argomenti inattesi: nessuna modifica eseguita';
  end if;
  if v_function.lanname <> 'sql' then
    raise exception 'La funzione non è in linguaggio SQL (%): nessuna modifica eseguita', v_function.lanname;
  end if;

  -- Corpo senza commenti e spazi superflui; ammesso un solo ";" finale.
  v_body := regexp_replace(v_function.prosrc, '--[^\n]*', '', 'g');
  v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'g');
  v_body := btrim(regexp_replace(v_body, '\s+', ' ', 'g'));
  v_body := regexp_replace(v_body, ';\s*$', '');
  if v_body !~* '^select\M' then
    raise exception 'Il corpo della funzione non è una singola SELECT: nessuna modifica eseguita';
  end if;
  if position(';' in v_body) > 0 then
    raise exception 'Il corpo della funzione contiene più istruzioni: nessuna modifica eseguita';
  end if;
  if v_body ~* '\m(insert|update|delete|merge|truncate|call|copy|perform|execute|lock|grant|revoke|create|alter|drop|notify|listen|nextval|setval|set_config|pg_notify|dblink\w*|lo_\w+|pg_advisory\w*)\M' then
    raise exception 'Il corpo della funzione contiene istruzioni o funzioni di scrittura: nessuna modifica eseguita';
  end if;

  -- Impronta di tutto ciò che NON deve cambiare: corpo, linguaggio, risultato,
  -- SECURITY DEFINER, impostazioni (search_path), proprietario, permessi.
  select concat_ws('|', md5(p.prosrc), p.prolang::text, pg_get_function_result(p.oid), p.prosecdef::text,
                   coalesce(p.proconfig::text, ''), p.proowner::text, coalesce(p.proacl::text, ''), p.proisstrict::text, p.proparallel::text)
    into v_before from pg_proc p where p.oid = v_function.oid;

  execute 'alter function public.nmre_get_gmail_tokens() stable';

  if (select provolatile from pg_proc where oid = v_function.oid) <> 's' then
    raise exception 'Verifica finale non superata: la funzione non risulta STABLE';
  end if;
  select concat_ws('|', md5(p.prosrc), p.prolang::text, pg_get_function_result(p.oid), p.prosecdef::text,
                   coalesce(p.proconfig::text, ''), p.proowner::text, coalesce(p.proacl::text, ''), p.proisstrict::text, p.proparallel::text)
    into v_after from pg_proc p where p.oid = v_function.oid;
  if v_after is distinct from v_before then
    -- L'eccezione annulla l'intera transazione, compresa la modifica della volatilità.
    raise exception 'Verifica finale non superata: è cambiato qualcosa oltre la volatilità';
  end if;
  raise notice 'public.nmre_get_gmail_tokens() ora è STABLE (SECURITY DEFINER: %, corpo invariato)', v_function.prosecdef;
end;
$migration$;

-- PostgREST rilegge lo schema per riconoscere la nuova volatilità.
notify pgrst, 'reload schema';
