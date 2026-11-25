-- =====================================================================
-- NMRE · Verifica P0 della produzione · SOLA LETTURA · versione 2
-- =====================================================================
-- Scopo: confrontare la produzione con il repository (RLS, policy, RPC,
-- privilegi, cron, frequenza ed errori della sincronizzazione Gmail).
--
-- Regole di sicurezza di questa versione:
--  * Solo SELECT su cataloghi di sistema e conteggi aggregati.
--    Nessuna query modifica dati, schema o configurazioni.
--  * I risultati sono pensati per essere CONDIVISIBILI:
--      - nessuna definizione completa di funzioni, trigger, policy o job:
--        il codice viene analizzato all'interno della query e restituito
--        solo come indicatori booleani;
--      - nessun messaggio di errore testuale: gli errori sono ricondotti a
--        categorie fisse e, quando presente, al solo codice HTTP;
--      - nessuna email, nome, telefono, testo di email, token, UID di
--        utenti o valore di Vault.
--  * Esegua le query una alla volta nel SQL Editor di Supabase. Per
--    sicurezza può anteporre a ciascuna:  set transaction read only;
--  * Se un indicatore "possibile_segreto_in_chiaro" risulta TRUE, non
--    cerchi il valore e non lo incolli: lo segnali e la chiave verrà
--    ruotata con una procedura dedicata.
--
-- Esiti già verificati dal titolare (25/11/2026), riportati per
-- confronto: RLS attiva su tutte le tabelle public; tabelle private
-- inaccessibili ai ruoli client; nmre_auto_archive_private_candidate
-- SECURITY INVOKER; job Gmail ogni minuto; nessun bucket Storage.
-- =====================================================================


-- Q1 · Tabelle negli schemi applicativi: RLS e numero di policy -------
select n.nspname as schema,
       c.relname as tabella,
       c.relrowsecurity as rls_attiva,
       c.relforcerowsecurity as rls_forzata,
       (select count(*) from pg_policies p
         where p.schemaname = n.nspname and p.tablename = c.relname) as numero_policy
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p')
   and n.nspname in ('public','private')
 order by 1, 2;


-- Q2 · Raggiungibilità reale degli schemi da parte dei ruoli client ----
-- Una tabella senza RLS è un problema EFFETTIVO solo se il ruolo ha
-- USAGE sullo schema e un privilegio sulla tabella.
select n.nspname as schema,
       has_schema_privilege('anon', n.oid, 'USAGE') as usage_anon,
       has_schema_privilege('authenticated', n.oid, 'USAGE') as usage_authenticated
  from pg_namespace n
 where n.nspname in ('public','private');

select n.nspname as schema, c.relname as tabella, c.relrowsecurity as rls_attiva,
       has_schema_privilege('anon', n.oid, 'USAGE')
         and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as raggiungibile_anon,
       has_schema_privilege('authenticated', n.oid, 'USAGE')
         and has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as raggiungibile_authenticated
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private')
 order by 1, 2;
-- ALLARME effettivo: righe con rls_attiva = false e raggiungibile_* = true.


-- Q3 · Policy RLS: solo indicatori, nessuna espressione completa -------
select schemaname, tablename, policyname, permissive, roles, cmd,
       coalesce(qual, '') ~ 'auth\.uid\(\)'        as using_usa_auth_uid,
       coalesce(qual, '') ~ 'owner_id'             as using_confronta_owner_id,
       coalesce(with_check, '') ~ 'auth\.uid\(\)'  as check_usa_auth_uid,
       coalesce(with_check, '') ~ 'owner_id'       as check_confronta_owner_id,
       coalesce(qual, '') in ('true','')
         and cmd in ('SELECT','ALL','UPDATE','DELETE') as using_sempre_vera
  from pg_policies
 where schemaname in ('public','private','storage')
 order by schemaname, tablename, cmd, policyname;
-- ALLARME: using_sempre_vera = true su una tabella con dati personali,
-- oppure ruoli che includono anon.


-- Q4 · Privilegi di tabella concessi ai ruoli client ------------------
select table_schema, table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privilegi
  from information_schema.role_table_grants
 where grantee in ('anon','authenticated','public')
   and table_schema in ('public','private')
 group by 1, 2, 3
 order by 1, 2, 3;


-- Q5 · Funzioni RPC: modalità, search_path ed esecutori ----------------
-- Il codice delle funzioni NON viene restituito: viene solo analizzato.
select p.proname as funzione,
       pg_get_function_identity_arguments(p.oid) as argomenti,
       case when p.prosecdef then 'DEFINER' else 'INVOKER' end as modalita,
       exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s
                where s like 'search_path=%') as search_path_fissato,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as esegue_anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as esegue_authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as esegue_service_role,
       p.prosrc ~ 'auth\.uid\(\)'                                 as usa_auth_uid,
       p.prosrc ~ 'owner_id'                                      as usa_owner_id,
       p.prosrc ~* '(auth\.role\(\)|auth\.jwt\(\)|service_role)'  as distingue_ruolo,
       p.prosrc ~* '(sb_secret_|eyJhbGci|GOCSPX-|-----BEGIN)'     as possibile_segreto_in_chiaro
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind = 'f'
   and p.proname like 'nmre%'
 order by p.prosecdef desc, p.proname;
-- Da osservare in particolare per nmre_auto_archive_private_candidate:
-- la funzione è chiamata anche dal backend con la service role
-- (nmre-gmail-scheduled/index.ts:860). Servono entrambe le condizioni:
--   esegue_service_role = true
--   distingue_ruolo = true   (cioè gestisce il caso auth.uid() nullo)
-- altrimenti l'archiviazione automatica dal backend fallisce.

-- Q5b · ALLARME: SECURITY DEFINER esposte o senza search_path ----------
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as esegue_anon,
       exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s
                where s like 'search_path=%') as search_path_fissato
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s
                        where s like 'search_path=%'));


-- Q6 · Trigger applicativi: solo indicatori ----------------------------
select tn.nspname as schema, c.relname as tabella, t.tgname as trigger,
       pn.nspname || '.' || p.proname as funzione,
       t.tgenabled <> 'D' as attivo,
       p.prosrc ~* 'net\.http_(post|get)'                      as chiama_http,
       p.prosrc ~* 'vault\.decrypted_secrets'                  as legge_vault,
       p.prosrc ~* '(sb_secret_|eyJhbGci|GOCSPX-|-----BEGIN)'  as possibile_segreto_in_chiaro
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace tn on tn.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
 where not t.tgisinternal
   and tn.nspname in ('public','private')
 order by 1, 2, 3;


-- Q7 · Job pg_cron: frequenza reale, senza mostrare il comando --------
select jobid, jobname, schedule, active,
       position('vault.decrypted_secrets' in command) > 0 as usa_vault,
       command ~* '(sb_secret_|eyJhbGci|service_role)'     as possibile_segreto_in_chiaro,
       substring(command from 'functions/v1/([a-z0-9-]+)') as funzione_chiamata,
       substring(command from 'timeout_milliseconds\s*:=\s*(\d+)')::int as timeout_ms
  from cron.job
 order by jobid;


-- Q8 · Esecuzioni cron (48 ore): conteggi e intervalli -----------------
with runs as (
  select d.jobid, d.status, d.start_time, d.end_time,
         d.start_time - lag(d.start_time) over (partition by d.jobid order by d.start_time) as intervallo
    from cron.job_run_details d
   where d.start_time > now() - interval '48 hours'
)
select j.jobname,
       count(*)                                   as esecuzioni_48h,
       count(*) filter (where r.status <> 'succeeded') as non_riuscite,
       round((percentile_cont(0.5) within group (order by extract(epoch from r.intervallo)) / 60)::numeric, 2) as intervallo_mediano_minuti,
       max(r.intervallo)                          as intervallo_max,
       max(r.start_time)                          as ultima_esecuzione
  from runs r
  join cron.job j on j.jobid = r.jobid
 group by j.jobname;
-- Nota: "succeeded" in pg_cron indica solo che la richiesta HTTP è
-- stata accodata da pg_net, non che la Edge Function abbia avuto
-- successo. L'esito reale è in Q9 e Q10.


-- Q9 · Risposte HTTP di pg_net (48 ore): solo codici e conteggi -------
select status_code, timed_out, (error_msg is not null) as con_errore_rete,
       count(*) as risposte, min(created) as prima, max(created) as ultima
  from net._http_response
 where created > now() - interval '48 hours'
 group by 1, 2, 3
 order by risposte desc;
-- Codici attesi: 200 (sincronizzazione eseguita), 202 (saltata perché
-- un'altra sincronizzazione era in corso), 500 (errore registrato).


-- Q10 · Sincronizzazioni Gmail (48 ore): esiti, durata e intervallo ---
with s as (
  select status, sync_mode, started_at, duration_ms,
         started_at - lag(started_at) over (order by started_at) as intervallo
    from public.nmre_gmail_sync_runs
   where started_at > now() - interval '48 hours'
)
select status, coalesce(sync_mode, 'non_indicato') as sync_mode,
       count(*) as sincronizzazioni,
       round(avg(duration_ms)) as durata_media_ms,
       percentile_cont(0.95) within group (order by duration_ms) as durata_p95_ms,
       max(duration_ms) as durata_max_ms,
       round((percentile_cont(0.5) within group (order by extract(epoch from intervallo)) / 60)::numeric, 2) as intervallo_mediano_minuti,
       min(started_at) as prima, max(started_at) as ultima
  from s
 group by 1, 2
 order by 1, 2;


-- Q11 · Errori Gmail (48 ore) per CATEGORIA, senza testo ---------------
-- Le categorie corrispondono ai messaggi generati da
-- supabase/functions/nmre-gmail-scheduled/index.ts.
with e as (
  select started_at, duration_ms, coalesce(error_message, '') as m
    from public.nmre_gmail_sync_runs
   where status = 'error' and started_at > now() - interval '48 hours'
)
select case
         when m ~* 'configurazione'                                   then 'configurazione_server'
         when m ~* 'blocco'                                           then 'blocco_sincronizzazione'
         when m ~* '(token|collegamento gmail|casella gmail)'         then 'token_oauth_o_casella'
         when m ~* 'limite di sicurezza'                              then 'limite_volume'
         when m ~* '(timed? ?out|abort|signal|timeout)'               then 'timeout'
         when m ~* '(profilo|cronologia|ricerca|messaggio) gmail'     then 'api_gmail'
         when m ~* 'watch'                                            then 'gmail_watch'
         when m ~* 'archiviazione automatica'                         then 'archiviazione_privato'
         when m ~* '(registro venditori)'                             then 'registro_venditori'
         when m ~* '(salvataggio|aggiornamento|lettura|verifica|pulizia|deduplicazione|storico|ricerca dell)' then 'database'
         else 'altro'
       end as categoria,
       substring(m from '\((\d{3})\)') as codice_http,
       count(*) as errori,
       round(avg(duration_ms)) as durata_media_ms,
       min(started_at) as primo, max(started_at) as ultimo
  from e
 group by 1, 2
 order by errori desc;

-- Q11b · Errori consecutivi massimi e distribuzione per ora (48 ore) ---
with s as (
  select started_at, status,
         sum(case when status <> 'error' then 1 else 0 end)
           over (order by started_at) as gruppo
    from public.nmre_gmail_sync_runs
   where started_at > now() - interval '48 hours'
)
select max(consecutivi) as massimo_errori_consecutivi
  from (select gruppo, count(*) filter (where status = 'error') as consecutivi
          from s group by gruppo) x;

select date_trunc('hour', started_at) as ora, count(*) filter (where status = 'error') as errori
  from public.nmre_gmail_sync_runs
 where started_at > now() - interval '48 hours'
 group by 1 having count(*) filter (where status = 'error') > 0
 order by 1;


-- Q12 · Crescita del registro delle sincronizzazioni -------------------
-- Con un'esecuzione al minuto il registro cresce di circa 1.440 righe al
-- giorno: serve a decidere la politica di conservazione.
select count(*) as righe_totali,
       min(started_at) as prima_riga,
       pg_size_pretty(pg_total_relation_size('public.nmre_gmail_sync_runs')) as dimensione
  from public.nmre_gmail_sync_runs;


-- Q13 · Utenti Auth: solo conteggi -------------------------------------
select count(*) as utenti_totali,
       count(*) filter (where email_confirmed_at is not null) as email_confermate,
       count(*) filter (where created_at > now() - interval '30 days') as creati_ultimi_30_giorni,
       count(*) filter (where banned_until is not null and banned_until > now()) as sospesi,
       count(*) filter (where last_sign_in_at > now() - interval '30 days') as accessi_ultimi_30_giorni
  from auth.users;

select factor_type, status, count(*) as fattori from auth.mfa_factors group by 1, 2;


-- Q14 · Proprietari distinti per tabella (conteggio) -------------------
select 'annunci' as tabella, count(distinct owner_id) as proprietari, count(*) as righe from public.annunci
union all select 'annunci_candidati', count(distinct owner_id), count(*) from public.annunci_candidati
union all select 'nmre_contacts',     count(distinct owner_id), count(*) from public.nmre_contacts
union all select 'nmre_properties',   count(distinct owner_id), count(*) from public.nmre_properties;


-- Q15 · Volume del contenuto email conservato (solo misure) ------------
-- Se dati_fonte fosse di tipo json e non jsonb, sostituire "dati_fonte ?"
-- con "(dati_fonte::jsonb) ?".
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


-- Q16 · Estensioni, bucket e policy Storage ----------------------------
select extname, extversion from pg_extension
 where extname in ('pg_cron','pg_net','supabase_vault','pgsodium','pgcrypto','postgis')
 order by 1;
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;
select count(*) as policy_storage_objects from pg_policies
 where schemaname = 'storage' and tablename = 'objects';
