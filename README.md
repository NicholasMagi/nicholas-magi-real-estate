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
- Analisi di mercato: importazione del CSV ufficiale OMI VALORI per le province marchigiane, filtri per comune/zona/tipologia/stato e confronto del prezzo richiesto con le fasce OMI.
- Registro dei compravenduti dichiarati: salva il corrispettivo dell'intero atto e il numero degli immobili; calcola il €/m² solo se l'atto riguarda una singola unità, il corrispettivo è confermato come attribuibile, i dati sono verificati e la superficie è espressa in m².
- Comparabili dei compravenduti: mediana e intervallo minimo/massimo €/m² raggruppati per comune, zona OMI, tipologia e categoria catastale; gli atti non attribuibili restano consultabili ma esclusi dai confronti.
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

## Analisi di mercato: OMI e compravendite dichiarate

NMRE mantiene separati due livelli informativi:

1. **Quotazioni OMI**: intervalli semestrali minimi/massimi in €/m² per zona omogenea, tipologia, destinazione d'uso e stato conservativo. Non sono prezzi realizzati su una singola compravendita e non sostituiscono una valutazione professionale.
2. **Compravendite dichiarate**: schede-atto anonimizzate della Consultazione Valori Immobiliari Dichiarati dell'Agenzia delle Entrate. Il corrispettivo resta riferito all'intero atto e non viene attribuito o ripartito automaticamente tra più immobili.

### Caricamento OMI

La sezione Analisi di mercato supporta due metodi:

- **Aggiornamento automatico**: legge gli shard JSON pubblici `/data/omi/<istat>.json` di Cruscotto Italia / AgID e importa il semestre più recente disponibile per Ancona (042002), Castelfidardo (042010), Jesi (042021) e Osimo (042034). La fonte dei dati è Agenzia delle Entrate - OMI; Cruscotto Italia dichiara licenza CC BY 4.0 e attribuzione obbligatoria «Agenzia delle Entrate - OMI». L'aggiornamento è manuale, su richiesta dell'utente, non automatico a ogni apertura della pagina.
- **CSV VALORI**: consente di importare semestri precedenti e altre località delle Marche dai file ufficiali VALORI dell'Agenzia delle Entrate (non il file ZONE). Il parser controlla il tracciato, gestisce codifica e delimitatori, conserva semestre e nome file e importa le province AN, MC, FM e AP. Le chiavi univoche impediscono di duplicare le stesse righe quando si reimporta lo stesso semestre e la stessa fonte.

Ogni riga conserva comune, codice ISTAT, zona e descrizione della zona, destinazione, tipologia, stato conservativo, intervalli di compravendita e locazione, base di superficie e provenienza. Il confronto di un immobile richiede comune, zona, tipologia, prezzo, superficie e scelta della base di superficie **lorda (L)** o **netta (N)**. La comparazione usa il semestre più recente disponibile per quella combinazione e non confronta basi di superficie diverse. Il rapporto prezzo richiesto/superficie è un confronto orientativo con l'intervallo OMI, non il prezzo di una transazione né una perizia.

### Compravendite dichiarate

Il registro consente di annotare manualmente i dati non identificativi delle schede-atto consultate presso l'Agenzia delle Entrate: mese e anno, tipologia di atto, numero di atti restituiti dalla ricerca, corrispettivo dichiarato dell'intero atto, numero di immobili coinvolti e, facoltativamente, zona OMI e riepilogo delle unità.

Il servizio mostra i risultati in forma anonimizzata e richiede almeno cinque atti nella ricerca. NMRE non effettua scraping del servizio, non salva nominativi, codici fiscali o indirizzi esatti e non divide il corrispettivo complessivo per il numero di immobili. Non calcola quindi un prezzo €/m² individuale a partire da un atto che può contenere più unità. Le schede registrate sono riferimenti documentali da consultare e interpretare, non comparabili individuali automaticamente validati.

Le tabelle `nmre_omi_quotazioni` e `nmre_compravendite_atti` hanno RLS attiva e policy di proprietà: ogni utente autenticato può leggere e modificare soltanto i propri dati.

Fonti: [Agenzia delle Entrate - Forniture dati OMI](https://www.agenziaentrate.gov.it/portale/schede/fabbricatiterreni/omi/forniture-dati-omi-cittadini), [Consultazione Valori Immobiliari Dichiarati - guida](https://servizionline.agenziaentrate.gov.it/pdf/OMI_ConsultazioneValoriImmobiliariDichiarati_GUIDA_AL_SERVIZIO.pdf), [informazioni per l'utilizzo dei dati](https://servizionline.agenziaentrate.gov.it/pdf/OMI_ConsultazioneValoriImmobiliariDichiarati_INFO_UTILIZZO_DATI.pdf), [tracciato CSV VALORI](https://telematici.agenziaentrate.gov.it/pdf/guidaFornitureOMI.pdf), [Cruscotto Italia / AgID - dati OMI](https://cruscotto-italia.dati.gov.it/data/).

## Architettura e sicurezza

- Frontend statico: GitHub Pages.
- Database, autenticazione e funzioni backend: Supabase.
- Email: Gmail API con OAuth 2.0 e scope di sola lettura.
- Tabelle operative: annunci, annunci_candidati, annunci_interazioni, `nmre_omi_quotazioni` e `nmre_compravendite_atti`.
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