-- =====================================================================
-- NMRE · Verifica P0 della produzione · SOLA LETTURA
-- =====================================================================
-- Scopo: confrontare la produzione con il repository (RLS, policy, RPC,
-- privilegi, cron, frequenza reale della sincronizzazione Gmail).
--
-- Regole:
--  * Ogni query è una SELECT su cataloghi di sistema o un conteggio
--    aggregato. Nessuna query modifica dati, schema o configurazioni.
--  * Nessuna query restituisce email, nomi, telefoni, testi di email,
--    token o valori dei segreti di Vault.
--  * Esegua le query una alla volta nel SQL Editor di Supabase
--    (l'editor mostra soltanto il risultato dell'ultima istruzione).
--  * Prima di condividere un risultato, lo rilegga: le definizioni delle
--    funzioni (Q6) e dei trigger (Q7) sono codice, ma se in produzione
--    qualcuno avesse scritto una chiave direttamente nel codice SQL,
--    comparirebbe lì. In quel caso NON la incolli in chat o su GitHub:
--    lo segnali e la ruoteremo.
--
-- Per maggiore sicurezza può anteporre a ogni query:
--   set transaction read only;
-- (in una transazione in sola lettura qualsiasi scrittura viene rifiutata).
-- =====================================================================


-- Q1 · Tabelle negli schemi applicativi e stato RLS ------------------
select n.nspname as schema,
       c.relname as tabella,
       c.relrowsecurity as rls_attiva,
       c.relforcerowsecurity as rls_forzata
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p')
   and n.nspname in ('public','private')
 order by 1, 2;


-- Q2 · ALLARME: tabelle esposte via API senza RLS --------------------
-- Atteso: nessuna riga.
select n.nspname as schema, c.relname as tabella
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p')
   and n.nspname = 'public'
   and c.relrowsecurity = false;


-- Q3 · Policy RLS complete ------------------------------------------
select schemaname, tablename, policyname, permissive, roles, cmd,
       qual as condizione_using, with_check
  from pg_policies
 where schemaname in ('public','private','storage')
 order by schemaname, tablename, cmd, policyname;


-- Q4 · ALLARME: tabelle con RLS attiva ma senza alcuna policy --------
-- (inaccessibili ai client: non è un rischio di sicurezza, ma va saputo)
select n.nspname as schema, c.relname as tabella
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p') and n.nspname = 'public' and c.relrowsecurity
   and not exists (select 1 from pg_policies p
                    where p.schemaname = n.nspname and p.tablename = c.relname);


-- Q5 · Privilegi di tabella concessi ai ruoli client ----------------
select table_schema, table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privilegi
  from information_schema.role_table_grants
 where grantee in ('anon','authenticated','public')
   and table_schema in ('public','private')
 group by 1, 2, 3
 order by 1, 2, 3;


-- Q6 · Funzioni RPC: security definer, search_path, chi può eseguirle --
select p.proname as funzione,
       pg_get_function_identity_arguments(p.oid) as argomenti,
       p.prosecdef as security_definer,
       p.proconfig as configurazione,
       has_function_privilege('anon', p.oid, 'EXECUTE') as eseguibile_anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as eseguibile_authenticated
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind = 'f'
 order by p.prosecdef desc, p.proname;

-- Q6b · ALLARME: security definer eseguibili da anon o senza search_path --
select p.proname, pg_get_function_identity_arguments(p.oid) as argomenti,
       has_function_privilege('anon', p.oid, 'EXECUTE') as eseguibile_anon,
       p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or p.proconfig is null
        or not exists (select 1 from unnest(p.proconfig) s where s like 'search_path=%'));

-- Q6c · Definizione delle RPC critiche non presenti nel repository --
-- (codice, non dati: va riletto prima di condividerlo)
select p.proname, pg_get_functiondef(p.oid) as definizione
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('nmre_auto_archive_private_candidate',
                     'nmre_save_oauth_state','nmre_consume_oauth_state',
                     'nmre_get_gmail_tokens','nmre_save_gmail_tokens');


-- Q7 · Trigger applicativi (es. invio push sulle notifiche) ---------
select event_object_schema as schema, event_object_table as tabella,
       trigger_name, action_timing, event_manipulation, action_statement
  from information_schema.triggers
 where event_object_schema in ('public','private')
 order by 1, 2, 3;


-- Q8 · Job pg_cron attivi: frequenza REALE ---------------------------
-- Il comando non viene mostrato per intero: si verifica solo se legge i
-- segreti da Vault e se contiene un possibile segreto scritto in chiaro.
select jobid, jobname, schedule, active, database, username,
       position('vault.decrypted_secrets' in command) > 0 as usa_vault,
       command ~* '(sb_secret_|eyJhbGci|service_role)' as possibile_segreto_in_chiaro,
       substring(command from 'functions/v1/[a-z0-9-]+') as funzione_chiamata
  from cron.job
 order by jobid;


-- Q9 · Esecuzioni cron delle ultime 48 ore e intervallo effettivo ---
with runs as (
  select j.jobname, d.status, d.start_time, d.end_time,
         left(d.return_message, 200) as messaggio,
         d.start_time - lag(d.start_time) over (partition by d.jobid order by d.start_time) as intervallo
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
   where d.start_time > now() - interval '48 hours'
)
select jobname,
       count(*) as esecuzioni_48h,
       count(*) filter (where status <> 'succeeded') as non_riuscite,
       min(intervallo) as intervallo_min,
       percentile_cont(0.5) within group (order by extract(epoch from intervallo)) / 60 as intervallo_mediano_minuti,
       max(intervallo) as intervallo_max,
       max(start_time) as ultima_esecuzione
  from runs
 group by jobname;


-- Q10 · Risposte HTTP di pg_net (ultime 48 ore) ----------------------
-- Il corpo della risposta NON viene letto.
select status_code, timed_out, count(*) as risposte,
       min(created) as prima, max(created) as ultima,
       max(left(error_msg, 200)) as esempio_errore
  from net._http_response
 where created > now() - interval '48 hours'
 group by status_code, timed_out
 order by risposte desc;


-- Q11 · Sincronizzazioni Gmail registrate (ultime 48 ore) -----------
-- Mostra quante volte la funzione ha davvero lavorato, con quale durata
-- e con quale intervallo, indipendentemente da chi l'ha avviata
-- (cron, Gmail Push o test manuale).
with s as (
  select status, sync_mode, started_at, duration_ms,
         started_at - lag(started_at) over (order by started_at) as intervallo
    from public.nmre_gmail_sync_runs
   where started_at > now() - interval '48 hours'
)
select count(*) as sincronizzazioni,
       count(*) filter (where status = 'error') as errori,
       count(*) filter (where sync_mode like 'full%') as complete,
       round(avg(duration_ms)) as durata_media_ms,
       max(duration_ms) as durata_max_ms,
       percentile_cont(0.5) within group (order by extract(epoch from intervallo)) / 60 as intervallo_mediano_minuti,
       min(intervallo) as intervallo_min,
       max(intervallo) as intervallo_max,
       max(started_at) as ultima
  from s;


-- Q12 · Utenti Auth: solo conteggi, nessun dato identificativo -------
select count(*) as utenti_totali,
       count(*) filter (where email_confirmed_at is not null) as email_confermate,
       count(*) filter (where created_at > now() - interval '30 days') as creati_ultimi_30_giorni,
       count(*) filter (where banned_until is not null and banned_until > now()) as sospesi,
       count(*) filter (where last_sign_in_at > now() - interval '30 days') as accessi_ultimi_30_giorni
  from auth.users;

-- Q12b · Fattori MFA registrati (conteggio) --------------------------
select factor_type, status, count(*) from auth.mfa_factors group by 1, 2;


-- Q13 · Proprietari distinti per tabella (conteggio) ----------------
-- Atteso: 1 proprietario per tabella. Più di 1 indica altri account
-- con dati propri: non si cancella nulla, si decide insieme.
select 'annunci' as tabella, count(distinct owner_id) as proprietari, count(*) as righe from public.annunci
union all select 'annunci_candidati', count(distinct owner_id), count(*) from public.annunci_candidati
union all select 'nmre_contacts', count(distinct owner_id), count(*) from public.nmre_contacts
union all select 'nmre_properties', count(distinct owner_id), count(*) from public.nmre_properties;


-- Q14 · Volume del contenuto email conservato (solo misure) ---------
-- Serve alla decisione sulla minimizzazione dei dati; non mostra testo.
select 'annunci_candidati' as tabella,
       count(*) filter (where dati_fonte ? 'body_text') as righe_con_testo_email,
       pg_size_pretty(coalesce(sum(length(dati_fonte->>'body_text')), 0)) as volume_testo,
       count(*) filter (where notification_sender is not null) as righe_con_mittente
  from public.annunci_candidati
union all
select 'annunci',
       count(*) filter (where dati_fonte ? 'body_text'),
       pg_size_pretty(coalesce(sum(length(dati_fonte->>'body_text')), 0)),
       count(*) filter (where notification_sender is not null)
  from public.annunci;


-- Q15 · Estensioni e bucket Storage --------------------------------
select extname, extversion from pg_extension
 where extname in ('pg_cron','pg_net','supabase_vault','pgsodium','pgcrypto','postgis')
 order by 1;
select id, public from storage.buckets order by id;
