# Nicholas Magi Real Estate

Applicazione web per la raccolta, la verifica e la gestione di opportunità immobiliari.

## Funzioni disponibili

- Accesso personale con Supabase Auth.
- Archivio annunci con ricerca, filtri per venditore e stato del contatto.
- Dettagli strutturati: tipologia immobile, superficie, locali, camere e bagni.
- Inserimento manuale e gestione dei contatti dei proprietari.
- Agenda dei richiami con scadenze passate, odierne e dei prossimi sette giorni.
- Storico di telefonate, WhatsApp, email, appuntamenti e note.
- Collegamento Gmail OAuth, con token conservati cifrati lato server.
- Acquisizione automatica di notifiche immobiliari in background.
- Monitoraggio delle sincronizzazioni Gmail: esito, durata, annunci letti, candidati inseriti, agenzie escluse, duplicati ed errori; vengono salvati soltanto contatori operativi, non il contenuto delle email.
- Coda di annunci privati riconosciuti e opportunità ambigue da approvare manualmente.
- Estrazione euristica di comune, prezzo, tipologia, superficie, locali, camere e bagni quando presenti nella notifica.
- Deduplicazione tramite ID Gmail.
- Esportazione CSV ed Excel dell'archivio e della coda candidati.

## Come funziona la raccolta Gmail

La sincronizzazione è server-side e continua anche quando il sito è chiuso. Il job nmre-gmail-hourly-sync viene eseguito ogni ora al minuto 15 UTC tramite pg_cron e pg_net. La funzione usa la Secret API Key letta da Supabase Vault; non è presente alcuna chiave segreta nel browser o nel repository.

La prima sincronizzazione importa i messaggi degli ultimi 30 giorni, con paginazione. Le sincronizzazioni successive usano la Gmail History API e leggono soltanto i messaggi aggiunti o spostati nella Posta in arrivo. Se Google restituisce un historyId scaduto (HTTP 404), la funzione esegue una nuova sincronizzazione completa degli ultimi 30 giorni e ricrea il cursore. Il cursore è conservato in uno schema privato, accessibile soltanto al backend.

La funzione legge il contenuto soltanto lato server e cerca notifiche di nuovi annunci con link verso i portali riconosciuti. Il corpo dei messaggi non viene salvato nelle tabelle dell'applicazione e non è visualizzato nel sito. Gli ID Gmail sono usati per la deduplicazione; il cursore viene aggiornato soltanto dopo il salvataggio riuscito dei candidati, così un errore può essere ritentato senza perdere messaggi.

### Classificazione delle opportunità

- **Privato riconosciuto:** la notifica contiene un'indicazione esplicita che il venditore è un privato. Il candidato può essere confermato nell'archivio.
- **Venditore da verificare:** l'email segnala un nuovo annuncio, ma non permette di stabilire con certezza se il venditore sia un privato. Il candidato viene mostrato e deve essere approvato manualmente con l'azione “Accetta come privato e inserisci”.
- **Agenzia riconosciuta:** le notifiche chiaramente riferite a un'agenzia vengono escluse dalla coda dedicata ai privati.
- **Notifiche non pertinenti:** verifiche account, messaggi di benvenuto, ricerche salvate, promozioni e annunci d'asta vengono escluse.

L'estrazione dei dati è euristica: titolo, comune, prezzo e URL possono richiedere correzioni manuali. Il sito mostra soltanto i dati dell'opportunità, non il mittente, l'oggetto o il testo dell'email. La coda si aggiorna ogni cinque minuti mentre il sito è aperto; la raccolta del server non dipende dalla pagina.

La vecchia funzione di lettura diretta nmre-gmail-reader è dismessa: non restituisce più il contenuto delle email.

## Dati estratti

I campi strutturati disponibili su candidati e archivio sono: tipologia immobile, superficie in m², numero locali, camere e bagni. L'estrazione è euristica e i campi mancanti restano vuoti per la correzione manuale. L'approvazione del candidato trasferisce questi dati nell'archivio definitivo.

Il parser e l'adattatore Gmail History sono separati nella cartella supabase/functions/nmre-gmail-scheduled/_shared e coperti da test automatici. Il workflow Validate application code esegue i test Deno del parser e della cronologia Gmail, i test del connettore Insights, controlla la sintassi JavaScript incorporata in index.html e verifica che gli ID HTML siano univoci.

## Architettura e sicurezza

- Frontend statico: GitHub Pages.
- Database, autenticazione e funzioni backend: Supabase.
- Email: Gmail API con OAuth 2.0 e scope di sola lettura.
- Tabelle operative: annunci, annunci_candidati, annunci_interazioni.
- Token OAuth cifrati e conservati in uno schema privato; chiavi e segreti sono custoditi lato server.
- Registro tecnico `nmre_gmail_sync_runs` con RLS: gli utenti autenticati possono leggere soltanto i propri riepiloghi; le scritture sono riservate al backend.
- Stato di sincronizzazione Gmail conservato separatamente dai token, in uno schema privato e accessibile soltanto al service role.
- RLS attiva sulle tabelle applicative e policy che limitano le righe all'utente proprietario.
- Il RPC di conferma dei candidati è eseguibile soltanto da utenti autenticati.
- Non inserire mai Secret API Key, service_role, credenziali Google o chiavi di cifratura nel frontend o nel repository.

La sincronizzazione pianificata ha una latenza massima ordinaria di circa un'ora. Le notifiche push Gmail quasi in tempo reale richiedono un topic Google Cloud Pub/Sub e l'autorizzazione di pubblicazione per Gmail; non sono necessarie per il funzionamento del job orario.

## Raccolta dai portali

L'importazione Gmail elabora le notifiche ricevute nella casella collegata. Non equivale a una scansione diretta e universale dei portali immobiliari e non effettua scraping. Gli avvisi dei portali riconosciuti includono Idealista, Immobiliare.it, Casa.it, Subito, Green-Acres, Gate-away, Trovacasa e Wikicasa.

Il connettore diretto nmre-insights-sync è predisposto per l'API ufficiale Immobiliare.it Insights / Comps Finder: cerca offerte di vendita filtrate per venditore privato e disponibilità del numero telefonico, poi importa i dati della scheda e il link. Il numero stesso non è esposto dal mapping API documentato. Richiede le credenziali professionali Insights come segreti server-side e l'abilitazione del prodotto da parte del fornitore.

Idealista dispone di una Search API, ma rilascia la chiave solo previa richiesta e valutazione del progetto. Il collegamento non viene abilitato finché non si ricevono documentazione tecnica ufficiale e credenziali. Green-Acres documenta un feed XML di pubblicazione degli annunci dell'agenzia, non una API per raccogliere annunci di privati. Subito supporta gestionali autorizzati per la pubblicazione e impone limitazioni sull'uso dei sistemi automatici e sui contatti commerciali agli inserzionisti.

Ogni importazione diretta deve utilizzare API, feed o accordi autorizzati con ciascun portale, rispettandone condizioni d'uso e limiti tecnici. Dettagli: docs/portal-integrations.md.

## Pubblicazione

L'app è pubblicata su GitHub Pages:

https://nicholasmagi.github.io/nicholas-magi-real-estate/