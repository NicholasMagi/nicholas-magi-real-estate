# Nicholas Magi Real Estate

Sistema personale per acquisire, verificare e gestire opportunità immobiliari provenienti da venditori privati, costruttori e nuove iniziative.

## Stato attuale verificato

- Frontend statico pubblicato tramite GitHub Pages.
- Accesso utenti e archivio annunci collegati a Supabase.
- Inserimento manuale degli annunci tramite la funzione `nmre-search-engine`.
- Collegamento Google OAuth e lettura di metadati email tramite `nmre-gmail-oauth-start`, `nmre-gmail-oauth-callback` e `nmre-gmail-reader`.
- Il pulsante Gmail attuale è un test di lettura: non equivale ancora all'importazione automatica degli annunci.
- Il repository contiene attualmente il frontend (`index.html`) e questo documento. Il codice delle Edge Functions e lo schema Supabase non sono versionati qui.

## Obiettivo del prodotto

Un unico archivio affidabile che raccolga opportunità immobiliari nell'area raggiungibile in circa 60 minuti da Castelfidardo, mantenendo per ogni opportunità:

- titolo, comune, zona e tipologia;
- prezzo e caratteristiche disponibili;
- tipologia del venditore e livello di verifica;
- fonte, URL originale e data di rilevazione;
- contatti, note e stato di lavorazione;
- eventuali duplicati o variazioni dello stesso annuncio.

## Copertura territoriale

- Il catalogo `territorio.js` contiene 225 Comuni delle Marche, raggruppati nelle cinque province.
- Il catalogo è usato per suggerimenti durante l'inserimento e per filtri provincia/Comune nell'archivio.
- La dashboard mostra il numero di annunci per provincia, i Comuni coperti, i principali Comuni per volume, i venditori privati e le aste.
- I Comuni fuori dalle Marche o non riconosciuti restano inseribili manualmente e vengono raggruppati come "Fuori repertorio".
- La provincia è derivata dal Comune nel frontend: non è stata aggiunta una colonna al database e non è richiesta alcuna migrazione.
- I test `territorio.test.js` controllano il totale, i conteggi provinciali, alcuni Comuni piccoli e la normalizzazione di accenti, apostrofi e sigle.

## Principi di sviluppo

1. **Fonti autorizzate:** usare API ufficiali, feed, notifiche email configurate dall'utente o accordi con i portali. Non introdurre scraping che violi condizioni d'uso, autenticazione o misure anti-bot.
2. **Un solo flusso di acquisizione:** ogni connettore invia i dati a un livello comune di normalizzazione e deduplicazione.
3. **Sicurezza:** chiavi pubbliche solo nel browser; segreti e token OAuth esclusivamente lato server, cifrati e mai inseriti nel repository.
4. **Tracciabilità:** conservare URL e fonte originale; distinguere dati importati da dati verificati manualmente.
5. **Costi controllati:** preferire servizi già disponibili e piani gratuiti; nessun servizio a pagamento senza approvazione esplicita.
6. **Modifiche reversibili:** sviluppare su branch dedicati, verificare e solo dopo pubblicare su `main`.

## Roadmap proposta

### Fase 1 — Affidabilità e gestione quotidiana
- Verificare schema database, policy RLS e contratti delle Edge Functions.
- Aggiungere ricerca e filtri nell'archivio senza cambiare il database.
- Migliorare validazione dei dati, messaggi di errore e stati di caricamento.
- Aggiungere esportazione CSV e una gestione chiara dei duplicati.

### Fase 2 — Importazione email
- Definire quali notifiche email sono autorizzate e quali campi contengono.
- Analizzare il contenuto delle email lato server, non nel browser.
- Estrarre i dati con controlli, mostrare una coda di revisione e chiedere conferma prima di salvare.
- Salvare identificativo del messaggio e impronta della fonte per evitare importazioni ripetute.

### Fase 3 — Connettori per portale
- Verificare separatamente disponibilità di API, feed, alert o accordi per ogni fonte.
- Attivare solo connettori consentiti e documentati.
- Pianificare esecuzioni server-side e monitorare errori, limiti e costi.

### Fase 4 — Pronto per un eventuale prodotto commerciale
- Separazione dei dati per utente/agenzia e ruoli.
- Consenso, privacy, conservazione e cancellazione dei dati.
- Monitoraggio, backup, gestione delle credenziali e verifica dei requisiti dei fornitori.

## Criteri prima di pubblicare

- Nessun segreto nel codice client o nel repository.
- Policy RLS verificate per lettura, inserimento, modifica ed eliminazione.
- Test di accesso con account autorizzato e non autorizzato.
- Test su annunci incompleti, URL non validi e duplicati.
- Verifica manuale dell'app pubblicata dopo ogni rilascio.

## Limiti noti da risolvere

- Il lettore Gmail attuale mostra mittente, oggetto, data e anteprima: non è ancora un parser né un importatore automatico.
- Il progetto Google OAuth è stato configurato in modalità di test; la continuità dei token e gli eventuali requisiti di verifica Google vanno risolti prima di affidargli un servizio 24/7.
- Prima di cambiare database o funzioni server occorre acquisire e verificare il relativo schema e codice: non vanno indovinati.
