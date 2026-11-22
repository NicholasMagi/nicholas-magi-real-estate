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
- Coda di annunci privati riconosciuti e opportunità ambigue da approvare manualmente.
- Estrazione euristica di comune, prezzo, tipologia, superficie, locali, camere e bagni quando presenti nella notifica.
- Deduplicazione tramite ID Gmail.
- Esportazione CSV ed Excel dell'archivio e della coda candidati.

## Come funziona la raccolta Gmail

La sincronizzazione è server-side e continua anche quando il sito è chiuso. Il job nmre-gmail-hourly-sync viene eseguito ogni ora al minuto 15 UTC tramite pg_cron e pg_net. La funzione usa la Secret API Key letta da Supabase Vault; non è presente alcuna chiave segreta nel browser o nel repository.

La funzione cerca fino a 100 messaggi degli ultimi 30 giorni nell'intera casella Gmail, inclusi quelli archiviati, legge il contenuto soltanto lato server e cerca notifiche di nuovi annunci con link verso i portali riconosciuti. Il corpo dei messaggi non viene salvato nelle tabelle dell'applicazione e non è visualizzato nel sito.

### Classificazione delle opportunità

- **Privato riconosciuto:** la notifica contiene un'indicazione esplicita che il venditore è un privato. Il candidato può essere confermato nell'archivio.
- **Venditore da verificare:** l'email segnala un nuovo annuncio, ma non permette di stabilire con certezza se il venditore sia un privato. Il candidato viene mostrato e deve essere approvato manualmente con l'azione “Accetta come privato e inserisci”.
- **Agenzia riconosciuta:** le notifiche chiaramente riferite a un'agenzia vengono escluse dalla coda dedicata ai privati.
- **Notifiche non pertinenti:** verifiche account, messaggi di benvenuto, ricerche salvate, promozioni e annunci d'asta vengono escluse.

L'estrazione dei dati è euristica: titolo, comune, prezzo e URL possono richiedere correzioni manuali. Il sito mostra soltanto i dati dell'opportunità, non il mittente, l'oggetto o il testo dell'email. La coda si aggiorna ogni cinque minuti mentre il sito è aperto; la raccolta del server non dipende dalla pagina.

La vecchia funzione di lettura diretta nmre-gmail-reader è dismessa: non restituisce più il contenuto delle email.

## Architettura e sicurezza

- Frontend statico: GitHub Pages.
- Database, autenticazione e funzioni backend: Supabase.
- Email: Gmail API con OAuth 2.0 e scope di sola lettura.
- Tabelle operative: annunci, annunci_candidati, annunci_interazioni.
- Token OAuth cifrati e conservati in uno schema privato; chiavi e segreti sono custoditi lato server.
- RLS attiva sulle tabelle applicative e policy che limitano le righe all'utente proprietario.
- Non inserire mai Secret API Key, service_role, credenziali Google o chiavi di cifratura nel frontend o nel repository.

## Raccolta dai portali

L'importazione Gmail elabora le notifiche ricevute nella casella collegata. Non equivale a una scansione diretta e universale dei portali immobiliari e non effettua scraping. Le integrazioni dirette devono utilizzare API, feed o accordi autorizzati con ciascun portale, rispettandone condizioni d'uso e limiti tecnici.

## Pubblicazione

L'app è pubblicata su GitHub Pages:

https://nicholasmagi.github.io/nicholas-magi-real-estate/
