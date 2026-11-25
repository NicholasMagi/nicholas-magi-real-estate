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
-- SECURITY INVOKER con EXECUTE per authenticated e service_role e
-- gestione esplicita di auth.uid() nullo; job Gmail ogni minuto;
-- 15 errori consecutivi del 24/11 sulla versione 49; nessun bucket.
--
-- Versione 3: aggiunte le query Q17–Q18 (episodio Gmail del 24/11) e la
-- sezione "Audit acquisizione" AQ1–AQ9. AQ8 è l'unica query che
-- restituisce identificativi e URL pubblici di annunci: è per uso
-- personale durante la revisione manuale e NON va condivisa.
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
-- nmre_auto_archive_private_candidate: verificata dal titolare
-- (esegue_service_role = true, caso auth.uid() nullo gestito). La query
-- resta utile come controllo di regressione dopo future migrazioni.

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


-- =====================================================================
-- EPISODIO GMAIL DEL 24/11 (punto aperto O9)
-- =====================================================================

-- Q17 · Migrazioni applicate: solo versione e nome ----------------------
-- Da confrontare con l'ora di distribuzione delle versioni 49 e 50+ di
-- nmre-gmail-scheduled (Dashboard → Edge Functions → Deployments).
select version, name
  from supabase_migrations.schema_migrations
 order by version desc
 limit 30;

-- Q18 · Pianificazione effettiva durante l'episodio -------------------
-- Se l'intervallo mediano è ~10 minuti, il 24/11 era attiva la
-- pianificazione */10 e non quella attuale di un minuto.
with r as (
  select d.jobid, d.start_time, d.status,
         d.start_time - lag(d.start_time) over (partition by d.jobid order by d.start_time) as intervallo
    from cron.job_run_details d
   where d.start_time between timestamptz '2026-11-24 04:00:00+00' and timestamptz '2026-11-24 08:30:00+00'
)
select j.jobname, count(*) as esecuzioni,
       round((percentile_cont(0.5) within group (order by extract(epoch from r.intervallo)) / 60)::numeric, 2) as intervallo_mediano_minuti,
       count(*) filter (where r.status <> 'succeeded') as non_riuscite
  from r join cron.job j on j.jobid = r.jobid
 group by j.jobname;


-- =====================================================================
-- AUDIT ACQUISIZIONE (piano di sviluppo, modulo A.0-bis)
-- Percorsi di scarto del codice: D1 sincronizzazione, D2 scarto
-- automatico in interfaccia per URL già scartato, D3 classificazione
-- manuale Agenzia, D4 scarto manuale, D5 storico/fuori codice.
-- =====================================================================

-- AQ1 · Distribuzione dei candidati -------------------------------------
select coalesce(tipo_venditore, 'n/d') as tipo_venditore,
       stato,
       seller_manual_override as override_manuale,
       coalesce(portale, 'n/d') as portale,
       count(*) as candidati,
       count(*) filter (where created_at > now() - interval '48 hours') as creati_48h,
       min(created_at) as primo, max(created_at) as ultimo
  from public.annunci_candidati
 group by 1, 2, 3, 4
 order by candidati desc;


-- AQ2 · Percorso di scarto INFERITO per ogni candidato scartato --------
-- Inferenza, non certezza: D1 azzera mittente e oggetto; D2 e D4 non
-- lasciano segni distinti, ma D2 richiede un altro scartato precedente
-- con lo stesso URL canonico (host + percorso, senza parametri).
with c as (
  select id, owner_id, stato, tipo_venditore, seller_manual_override,
         notification_sender, email_subject, created_at, updated_at,
         rtrim(lower(regexp_replace(url, '^https?://(www\.)?([^/?#]+)([^?#]*).*$', '\2\3')), '/') as chiave_url
    from public.annunci_candidati
)
select case
         when s.tipo_venditore = 'Agenzia' and s.seller_manual_override then 'D3_manuale_agenzia'
         when s.tipo_venditore = 'Agenzia' then 'agenzia_senza_override_storico'
         when not s.seller_manual_override
              and s.notification_sender is null and s.email_subject is null then 'D1_sincronizzazione_probabile'
         when s.chiave_url is not null and exists (
                select 1 from c o
                 where o.owner_id = s.owner_id and o.id <> s.id and o.stato = 'scartato'
                   and o.chiave_url = s.chiave_url and o.updated_at < s.updated_at)
              then 'D2_o_D4_stesso_url_gia_scartato'
         else 'D4_manuale_o_D5_storico'
       end as percorso_inferito,
       coalesce(s.tipo_venditore, 'n/d') as tipo_venditore,
       count(*) as scartati,
       count(*) filter (where s.created_at > now() - interval '48 hours') as creati_48h
  from c s
 where s.stato = 'scartato'
 group by 1, 2
 order by scartati desc;


-- AQ3 · Regola del classificatore ricondotta alle etichette fisse -------
-- seller_evidence non viene mostrato: viene solo confrontato con le
-- etichette scritte nel codice (_shared/parser.ts e index.ts).
select stato, coalesce(tipo_venditore, 'n/d') as tipo_venditore,
       case
         when seller_manual_override then 'manuale'
         when seller_evidence is null then 'assente'
         when seller_evidence like 'Nessuna indicazione affidabile%' then 'nessuna_indicazione'
         when seller_evidence like 'Segnali contrastanti%' then 'segnali_contrastanti'
         when seller_evidence like 'Segnali discordanti tra annuncio e registro%' then 'discordanza_annuncio_registro'
         when seller_evidence like 'Identificativi presenti nel registro con classificazioni discordanti%' then 'discordanza_interna_registro'
         when seller_evidence like 'Corrispondenza esatta con il registro%' then 'registro_venditori'
         when seller_evidence ~ '^(Etichetta esplicita|Annuncio o vendita tra privati|Assenza dichiarata|Vendita dichiarata|Vendita indicata)' then 'regola_privato'
         when seller_evidence ~ '^(Venditore indicato come agenzia|Indicazione di contatto|Inserzionista riconducibile|Società immobiliare|Inserzionista identificato)' then 'regola_agenzia'
         else 'altro'
       end as regola,
       coalesce(seller_classification_version, 0) as versione_classificatore,
       coalesce(data_extraction_version, 0) as versione_estrazione,
       count(*) as candidati
  from public.annunci_candidati
 group by 1, 2, 3, 4, 5
 order by candidati desc;


-- AQ4 · Segnali nel testo conservato: solo CONTEGGI -------------------
-- Indicatori, non prove: "da privato" può comparire anche nei testi
-- standard dei portali (es. "pubblica il tuo annuncio da privato").
-- Per questo il risultato va confermato con la revisione AQ8.
with t as (
  select stato, coalesce(tipo_venditore, 'n/d') as tipo_venditore,
         coalesce(portale, 'n/d') as portale,
         coalesce(dati_fonte->>'body_text', '') || ' ' ||
         coalesce(email_subject, '') || ' ' || coalesce(titolo, '') as testo
    from public.annunci_candidati
)
select stato, tipo_venditore, portale,
       count(*) as candidati,
       count(*) filter (where length(testo) > 40)                                   as con_testo,
       count(*) filter (where testo ~* '\mda (un )?privat[oa]\M')                     as da_privato_singolare,
       count(*) filter (where testo ~* '\mprivat[oi]\M')                              as parola_privato,
       count(*) filter (where testo ~* '\mproprietari[oa]\M')                         as parola_proprietario,
       count(*) filter (where testo ~* '\m(senza|no|nessuna) (agenzi|intermediar)')   as senza_agenzia,
       count(*) filter (where testo ~* '\magenzi[ae]\M')                              as parola_agenzia,
       count(*) filter (where testo ~* '(tecnocasa|tempocasa|gabetti|re/?max|engel|professionecasa)') as marchio_agenzia,
       count(*) filter (where testo ~* '\m(s\.?r\.?l|s\.?a\.?s|s\.?n\.?c|s\.?p\.?a)\M')  as forma_societaria
  from t
 group by 1, 2, 3
 order by candidati desc;


-- AQ5 · Conservazione di URL, testo e storico notifiche ---------------
select c.stato, coalesce(c.tipo_venditore, 'n/d') as tipo_venditore,
       count(*) as candidati,
       count(*) filter (where c.url is not null)            as con_url,
       count(*) filter (where c.url_originale is not null)  as con_url_originale,
       count(*) filter (where c.listing_key is not null)    as con_listing_key,
       count(*) filter (where c.source_email_id is not null) as con_id_email,
       count(*) filter (where c.dati_fonte ? 'body_text')   as con_testo_sorgente,
       count(*) filter (where n.notifiche > 0)              as con_notifiche,
       coalesce(sum(n.notifiche), 0)                        as notifiche_totali
  from public.annunci_candidati c
  left join lateral (
    select count(*) as notifiche
      from public.annunci_candidati_notifiche x
     where x.owner_id = c.owner_id and x.candidate_id = c.id
  ) n on true
 group by 1, 2
 order by candidati desc;

-- AQ5b · Gruppi di duplicati per listing_key ---------------------------
select count(*) as gruppi_duplicati,
       sum(n) as candidati_coinvolti,
       count(*) filter (where stati > 1) as gruppi_con_stati_diversi,
       count(*) filter (where ha_scartato and ha_coda) as gruppi_scartato_e_in_coda
  from (
    select listing_key, count(*) as n, count(distinct stato) as stati,
           bool_or(stato = 'scartato') as ha_scartato,
           bool_or(stato = 'da_verificare') as ha_coda
      from public.annunci_candidati
     where listing_key is not null
     group by listing_key
    having count(*) > 1
  ) g;


-- AQ6 · Candidati idonei alla rielaborazione a ogni ciclo ---------------
-- Replica il filtro di nmre-gmail-scheduled/index.ts:486-506. Se
-- "idonei_con_gemello" è > 0 e stabile nel tempo, quei candidati
-- vengono riletti da Gmail a ogni esecuzione (vedi piano, A.0-bis).
select count(*) as idonei_rielaborazione,
       count(*) filter (where exists (
         select 1 from public.annunci_candidati o
          where o.owner_id = c.owner_id and o.id <> c.id
            and o.listing_key is not null and o.listing_key = c.listing_key)) as idonei_con_gemello,
       count(*) > 200 as oltre_limite_200
  from public.annunci_candidati c
 where c.stato = 'da_verificare'
   and c.source_email_id is not null and c.source_email_id <> ''
   and c.seller_manual_override is not true
   and (coalesce(c.deduplication_version, 0) < 1
        or coalesce(c.seller_classification_version, 0) < 3
        or coalesce(c.data_extraction_version, 0) < 6);


-- AQ7 · Tempo tra creazione e scarto ------------------------------------
-- Pochi minuti indicano un percorso automatico (D1/D2); tempi lunghi
-- sono compatibili con una decisione manuale. updated_at può essere
-- toccato anche dopo lo scarto: il dato è indicativo.
select case
         when updated_at - created_at < interval '5 minutes'  then '1_meno_5_minuti'
         when updated_at - created_at < interval '1 hour'     then '2_5_60_minuti'
         when updated_at - created_at < interval '24 hours'   then '3_1_24_ore'
         else '4_oltre_24_ore'
       end as tempo_allo_scarto,
       count(*) as scartati,
       count(*) filter (where created_at > now() - interval '48 hours') as creati_48h
  from public.annunci_candidati
 where stato = 'scartato'
 group by 1
 order by 1;


-- AQ8 · CAMPIONE PER LA REVISIONE MANUALE (USO PERSONALE, NON CONDIVIDERE)
-- Restituisce identificativo interno, portale e URL pubblico dell'annuncio.
-- Nessun testo di email, mittente o recapito. Annotare l'esito reale
-- (Privato / Agenzia / Non più online / Non determinabile) su un foglio
-- personale, non nel repository.
(select 'A_da_verificare_scartato' as gruppo, id, portale, coalesce(url, url_originale) as link
   from public.annunci_candidati
  where stato = 'scartato' and tipo_venditore = 'Da verificare'
  order by random() limit 40)
union all
(select 'B_agenzia_scartato', id, portale, coalesce(url, url_originale)
   from public.annunci_candidati
  where stato = 'scartato' and tipo_venditore = 'Agenzia')
union all
(select 'C_da_verificare_in_coda', id, portale, coalesce(url, url_originale)
   from public.annunci_candidati
  where stato = 'da_verificare'
  order by random() limit 40);


-- AQ9 · Somme dei contatori di sincronizzazione (48 ore) ---------------
-- Conferma l'interpretazione dei 671 rilevati: la differenza tra
-- notifiche immobiliari e righe classificate corrisponde alle
-- esclusioni come agenzia, che oggi non vengono salvate.
select sum(property_notifications_count) as notifiche_immobiliari,
       sum(excluded_agencies_count)      as escluse_come_agenzia,
       sum(needs_user_review_count)      as da_verificare,
       sum(private_recognized_count)     as privati_riconosciuti,
       sum(inserted_count)               as inseriti,
       sum(updated_count)                as aggiornati,
       sum(discarded_existing_count)     as scartati_in_sincronizzazione,
       sum(auto_archived_count)          as archiviati_automaticamente,
       count(*) filter (where coalesce(property_notifications_count, 0) > 0) as esecuzioni_con_notifiche
  from public.nmre_gmail_sync_runs
 where status = 'success' and started_at > now() - interval '48 hours';


-- =====================================================================
-- AUDIT ACQUISIZIONE · AGGIUNTE DEL 25/11 (docs/proposte/A1-nessuna-opportunita-persa.md)
-- =====================================================================

-- AQ10 · Email escluse dal filtro avvisi PRIMA del salvataggio (48 ore) ---
-- read_count = email lette (escluse spam/cestino); property_notifications
-- = email che hanno superato il filtro. La differenza comprende email non
-- immobiliari legittime E avvisi reali esclusi per errore (L1–L4): è un
-- limite superiore, non una stima delle perdite. Dopo la patch di Fase 1 la
-- ripartizione per regola è nei log della funzione (propertyFilterRules).
-- ATTENZIONE: i contatori sono somme per esecuzione, quindi contano LETTURE,
-- non email distinte. Esito del 25/11/2026: escluse_dal_filtro = 73 letture
-- escluse in 48 ore, che possono includere la stessa email riletta più volte
-- (per esempio per la rielaborazione) e non sono necessariamente 73 avvisi
-- immobiliari distinti.
select sum(listed_count)                                   as messaggi_elencati,
       sum(read_count)                                     as email_lette,
       sum(property_notifications_count)                   as avvisi_accettati,
       sum(read_count) - sum(property_notifications_count) as escluse_dal_filtro,
       sum(listed_count) - sum(read_count)                 as spam_cestino_o_mancanti,
       sum(missing_messages_count)                         as messaggi_non_piu_esistenti
  from public.nmre_gmail_sync_runs
 where status = 'success' and started_at > now() - interval '48 hours';


-- AQ11 · Vincoli di annunci_candidati (prerequisito della patch) -------
-- Definizioni di vincoli: schema, non dati. Verificare che nessun vincolo
-- impedisca tipo_venditore = 'Agenzia' con stato = 'da_verificare'.
select conname as vincolo, contype as tipo,
       pg_get_constraintdef(oid) ~ 'stato'          as riguarda_stato,
       pg_get_constraintdef(oid) ~ 'tipo_venditore' as riguarda_tipo_venditore,
       case when contype = 'c' then pg_get_constraintdef(oid) end as definizione_check
  from pg_constraint
 where conrelid = 'public.annunci_candidati'::regclass
 order by contype, conname;


-- AQ12 · Trigger su annunci_candidati e annunci_candidati_notifiche ----
-- Se un trigger crea notifiche push a ogni inserimento, le agenzie
-- conservate dalla patch genererebbero avvisi "Nuove opportunità".
select c.relname as tabella, t.tgname as trigger,
       t.tgenabled <> 'D' as attivo,
       (t.tgtype & 4) <> 0  as su_insert,
       (t.tgtype & 16) <> 0 as su_update,
       p.proname as funzione,
       p.prosrc ~* 'nmre_notifications'      as crea_notifiche,
       p.prosrc ~* 'tipo_venditore'          as filtra_per_tipo_venditore,
       p.prosrc ~* 'price_drop|ribass'       as riguarda_ribassi
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
 where not t.tgisinternal
   and c.relname in ('annunci_candidati', 'annunci_candidati_notifiche')
 order by 1, 2;


-- AQ13 · Decisioni registrate nello storico (dopo la patch) ------------
-- Conta le voci di dati_estratti.storico_stato per azione e origine.
select coalesce(c.stato, 'n/d') as stato_attuale,
       e->>'azione'  as azione,
       e->>'origine' as origine,
       count(*) as voci,
       count(distinct c.id) as candidati,
       max(e->>'data') as ultima
  from public.annunci_candidati c
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(c.dati_estratti->'storico_stato') = 'array'
         then c.dati_estratti->'storico_stato' else '[]'::jsonb end) e
 group by 1, 2, 3
 order by voci desc;


-- AQ14 · Registro venditori: rischio di corrispondenze per sottostringa --
-- Solo lunghezze e conteggi: gli identificativi non vengono mostrati.
select seller_type, identifier_type,
       count(*) as identificativi,
       count(*) filter (where identifier_type = 'identity' and length(identifier_normalized) < 8)
         as identita_brevi_meno_8,
       count(*) filter (where identifier_type = 'identity' and identifier_normalized !~ ' ')
         as identita_di_una_sola_parola,
       min(length(identifier_normalized)) as lunghezza_min
  from public.seller_identity_registry
 group by 1, 2
 order by 1, 2;


-- AQ15 · Avvisi dubbi (dopo la migrazione 20261125201000 e l'attivazione
-- di NMRE_CAPTURE_DUBIOUS_ALERTS): solo conteggi per stato, regola e prova.
select stato, regola_esclusione, prova, coalesce(portale, 'n/d') as portale,
       count(*) as avvisi, min(created_at) as primo, max(created_at) as ultimo
  from public.nmre_gmail_avvisi_dubbi
 group by 1, 2, 3, 4
 order by avvisi desc;

-- AQ16 · Notifiche arrivate dopo lo scarto (dopo la patch) -------------
select count(*) filter (where (dati_estratti->'notifiche_dopo_scarto'->>'da_rivedere')::boolean) as da_rivedere,
       count(*) filter (where dati_estratti ? 'notifiche_dopo_scarto') as con_notifiche_dopo_scarto,
       coalesce(sum((dati_estratti->'notifiche_dopo_scarto'->>'conteggio')::int), 0) as notifiche_totali
  from public.annunci_candidati
 where stato = 'scartato';


-- AQ17 · Trigger di notifica push: verifica PRIMA delle migrazioni ------
-- 20261125200000 (new_opportunities) e 20261125202000 (price_drop).
-- La definizione del trigger è schema, non dati. Della funzione si
-- restituiscono solo indicatori: il codice resta in produzione.
-- Atteso: un solo trigger di notifica per ciascuna tabella, AFTER, FOR EACH
-- ROW; su annunci_candidati_notifiche eventi INSERT e/o UPDATE.
select c.relname as tabella,
       t.tgname as trigger,
       pg_get_triggerdef(t.oid) as definizione_trigger,
       pn.nspname || '.' || p.proname as funzione,
       t.tgenabled as abilitazione,
       (t.tgtype & 1) <> 0  as per_riga,
       (t.tgtype & 2) <> 0  as before,
       (t.tgtype & 4) <> 0  as su_insert,
       (t.tgtype & 16) <> 0 as su_update,
       t.tgqual is not null as ha_condizione_when,
       p.prosrc ~* 'nmre_notifications'           as crea_notifiche,
       p.prosrc ~* 'new_opportunities'            as categoria_new_opportunities,
       p.prosrc ~* 'price_drop'                   as riguarda_price_drop,
       p.prosrc ~* 'tipo_venditore'               as considera_tipo_venditore,
       p.prosecdef                                as security_definer,
       pg_get_triggerdef(t.oid) like '%nmre_candidate_is_agency%'
         or pg_get_triggerdef(t.oid) ilike '%tipo_venditore%IS DISTINCT FROM%Agenzia%' as gia_protetto
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
 where not t.tgisinternal
   and c.relname in ('annunci_candidati', 'annunci_candidati_notifiche')
 order by 1, 2;
-- Per leggere il codice della funzione (solo il titolare, senza condividerlo):
--   select pg_get_functiondef('<schema>.<funzione>'::regproc);
