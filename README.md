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
- Doppio punteggio in coda: priorità di acquisizione (venditore, freschezza, territorio e contatto) separata dalla qualità/completezza dei dati; mostra anche il rapporto tra prezzo richiesto e m² quando calcolabile, senza presentarlo come stima di mercato.
- Estrazione migliorata di comune, prezzo, tipologia, superficie, locali, camere e bagni, con gestione dei formati italiani (€, euro, mila, mq, m²) e più categorie immobiliari.
- Versionamento dell'estrazione: le notifiche Gmail ancora in coda vengono rielaborate una sola volta quando cambia il parser; le classificazioni manuali dei venditori restano protette.
- Deduplicazione tramite ID Gmail.
- Analisi di mercato OMI: importazione CSV ufficiali VALORI per le province marchigiane AN, MC, FM e AP, filtri per comune/zona/tipologia/semestre e confronto tra prezzo richiesto al m² e intervallo OMI.
- Registro separato delle schede-atto della Consultazione Valori Immobiliari Dichiarati: corrispettivo complessivo dell'atto, mese, tipologia e numero di immobili; nessuna ripartizione automatica del prezzo su singole unità.
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

## Analisi OMI e compravendite dichiarate

La sezione **Analisi di mercato** mantiene separati tre livelli informativi:

1. **Quotazioni OMI**: l'utente scarica il file CSV VALORI dall'area ufficiale Forniture dati OMI dell'Agenzia delle Entrate e lo importa nell'app. Il parser riconosce il tracciato VALORI (comune, codice ISTAT, provincia, fascia, zona, link zona, tipologia, stato, compravendita min/max €/m² e locazione min/max €/m²/mese), gestisce delimitatori e numeri nel formato italiano e importa le province AN, MC, FM e AP. Il file ZONE da solo non contiene i valori economici e viene rifiutato.
2. **Confronto OMI**: consente di confrontare il prezzo richiesto per m² con l'intervallo OMI dell'ultimo semestre importato per comune, zona, tipologia e stato conservativo. Viene mostrato anche il riferimento alla superficie OMI (lorda/netta). È un confronto orientativo, non una perizia e non un prezzo di singola transazione.
3. **Compravendite dichiarate**: il registro consente di annotare manualmente i dati non identificativi delle schede-atto consultate presso l'Agenzia delle Entrate. Il campo corrispettivo resta riferito all'intero atto; quando l'atto include più immobili, NMRE non lo divide per la superficie né attribuisce prezzi individuali alle unità. Non sono richiesti nomi, codici fiscali o indirizzi esatti.

Le tabelle `nmre_omi_quotazioni` e `nmre_compravendite_atti` hanno RLS attiva e policy di proprietà: ogni utente autenticato può leggere e modificare soltanto i propri dati. Le quotazioni conservano semestre, comune, zona, fonte, file importato e campi grezzi essenziali per la tracciabilità. Per l'uso dei dati OMI va citata la fonte “Agenzia Entrate - OMI”.

## Punteggi della coda candidati

La **priorità di acquisizione** (0–100) ordina il lavoro commerciale: venditore privato riconosciuto (25 punti) o venditore da verificare (7), freschezza della pubblicazione (fino a 20; la sola data di notifica vale meno), territorio principale (20) o esteso (10), contatto diretto inserito (15), link specifico (10), prezzo (4), superficie (4) e tipologia (2). Il punteggio non certifica il venditore: una classificazione non supportata resta da verificare.

La **qualità dei dati** (0–100) misura la completezza della scheda: comune (15), prezzo (15), tipologia (10), superficie (15), locali (5), link specifico (15), data di pubblicazione (10), venditore privato verificato con confidenza almeno 90% (10) e contatto inserito (5).

Il rapporto **prezzo richiesto / m²** viene mostrato solo quando entrambi i dati sono presenti. È un indicatore descrittivo dell'annuncio, non una comparazione con i valori di mercato né una valutazione della convenienza economica.

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