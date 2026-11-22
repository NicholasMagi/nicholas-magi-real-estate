# Sincronizzazione Gmail programmata

La Edge Function `nmre-gmail-scheduled` è già distribuita su Supabase. È autenticata con `withSupabase({ auth: "secret" })` e il gateway ha `verify_jwt=false`: la chiamata deve quindi includere la **Supabase Secret API key** nell'header `apikey`. Non usa una chiave nel browser.

## Attivazione manuale necessaria

1. In Supabase Dashboard apra **Project Settings → API Keys** e copi la **Secret API key predefinita** (nome della chiave: `default`, formato `sb_secret_...`). Non usi la Publishable key né una secret key con un nome diverso: la funzione accetta la chiave `default`.
2. Apra **Database → Vault → Create new secret**.
3. Crei un segreto con:
   - **Name:** `secret_key`
   - **Secret:** la Secret API key copiata al punto 1.
4. Verifichi che il segreto sia salvato in Vault. Non invii la chiave in chat e non la inserisca in GitHub.
5. Apra **SQL Editor**, copi il contenuto di `supabase/cron/gmail-hourly-sync.sql` e lo esegua.
6. In **Integrations → Cron** verifichi il job `nmre-gmail-hourly-sync`. Il job viene eseguito ogni ora al minuto 15.

Lo script salva l'URL del progetto in Vault con il nome `project_url` se manca, poi crea il job. Nota tecnica: pg_net concede per impostazione predefinita `USAGE` sullo schema `net` anche a `anon` e `authenticated`; Supabase documenta che lo schema non è esposto tramite Data API e questi ruoli non possono aprire connessioni SQL dirette. Non esporre comunque `net` tra gli schemi Data API. Il segreto `secret_key` deve esistere prima di eseguire lo SQL.

## Verifica

Dopo la prima esecuzione, controlli `cron.job_run_details` per il job `nmre-gmail-hourly-sync`. La funzione restituisce conteggi aggregati (email elencate, lette, candidate, inserite, duplicati, errori) e non registra il contenuto delle email.

La sincronizzazione legge fino a 25 email della Posta in arrivo degli ultimi 30 giorni. Riconosce le email immobiliari con segnali testuali e link verso una allowlist di portali; deduplica tramite `owner_id,dedup_key`. Non effettua scraping dei portali.

**Sicurezza:** Vault conserva la chiave; non inserirla nel frontend, in file del repository o in messaggi. Supabase documenta che pg_net può mantenere temporaneamente gli header della richiesta in coda fino all'invio: mantenere l'accesso al database e agli schemi di rete strettamente controllato.
