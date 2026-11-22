# Sincronizzazione Gmail programmata

## Stato attuale

- Edge Function `nmre-gmail-scheduled`: attiva (versione 13).
- Edge Function `nmre-gmail-reader`: dismessa; restituisce HTTP 410 e non espone più il contenuto dei messaggi.
- Job `nmre-gmail-hourly-sync`: attivo, ogni ora al minuto 15 UTC.
- Supabase Vault contiene i segreti `project_url` e `secret_key`; non leggere né condividere i relativi valori.
- Chiamata HTTP server-to-server autenticata con la Secret API Key predefinita, tramite `withSupabase({ auth: "secret" })` e `verify_jwt=false`.

## Come funziona

La funzione cerca fino a 100 messaggi degli ultimi 30 giorni nell'intera casella Gmail, inclusi quelli archiviati. Estrae inoltre tipologia dell'immobile, superficie in m², locali, camere e bagni quando riconoscibili nel testo della notifica; risolve i link di tracciamento dei portali quando possibile, senza scaricare o archiviare le schede. Il parser condiviso è coperto da test Deno. Legge ed elabora il testo soltanto sul server, riconosce gli avvisi di nuovi annunci e conserva soltanto i dati estratti necessari alla gestione del candidato. Non memorizza il corpo dell'email, il mittente o l'oggetto.

- I venditori esplicitamente indicati come privati vengono classificati `Privato`.
- Gli annunci per cui non è chiaro il tipo di venditore restano `Da verificare` e richiedono approvazione manuale.
- Le notifiche chiaramente di agenzia, le email di verifica account, i messaggi di benvenuto, le ricerche salvate, le promozioni e gli annunci d'asta vengono escluse.
- La deduplicazione utilizza `owner_id,dedup_key` con la chiave derivata dall'ID Gmail.
- Il processo non effettua scraping dei portali immobiliari.

Il sito mostra la coda di candidati e non le email. Quando la pagina è aperta, la coda viene aggiornata ogni cinque minuti. Il processo server-side continua anche a pagina chiusa.

## SQL di configurazione

Il file `supabase/cron/gmail-hourly-sync.sql` è idempotente: crea il job se manca oppure aggiorna quello esistente. Prima di eseguirlo su un nuovo progetto, creare in Supabase Vault:

- `project_url`: URL HTTPS del progetto Supabase.
- `secret_key`: Secret API Key predefinita (nome API key: `default`).

Non inserire mai la chiave nel file SQL, nel frontend, in GitHub o in chat. Il file imposta un timeout HTTP di 30 secondi.

## Verifica

Controllare il job:

`select jobid, jobname, schedule, active from cron.job where jobname = 'nmre-gmail-hourly-sync';`

Dopo una sua esecuzione automatica, controllare `cron.job_run_details`. Per verificare la risposta della funzione, controllare `net._http_response` usando il `request_id` restituito da `net.http_post`. È stata verificata una prima esecuzione automatica con esito `succeeded`; le sincronizzazioni manuali Gmail hanno restituito HTTP 200.

