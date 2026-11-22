# Nicholas Magi Real Estate

Applicazione web per la raccolta, verifica e gestione di opportunità immobiliari.

## Funzioni disponibili

- Accesso personale con Supabase Auth.
- Archivio annunci con ricerca testuale e filtro per tipologia di venditore.
- Inserimento manuale e cancellazione degli annunci.
- Collegamento Gmail OAuth con lettura della casella dedicata.
- Lettura delle ultime 25 email in arrivo degli ultimi 30 giorni.
- Riconoscimento euristico delle notifiche immobiliari e importazione automatica tra i candidati.
- Deduplicazione delle email tramite ID Gmail.
- Revisione dei candidati prima della conferma nell'archivio definitivo.
- Esportazione dell'archivio in formato CSV.

## Sincronizzazione Gmail

La casella autorizzata viene controllata all'apertura dell'app e, se la pagina rimane aperta, ogni 60 minuti. Le notifiche riconosciute vengono inserite in `annunci_candidati` con stato `da_verificare`. L'utente deve controllare i dati e confermare ogni candidato prima che diventi un annuncio definitivo.

La sincronizzazione dal browser non continua quando l'app viene chiusa. Un processo server-side pianificato richiede un ulteriore componente di automazione e una configurazione sicura.

## Architettura

- Frontend statico: GitHub Pages.
- Database, autenticazione e funzioni backend: Supabase.
- Email: Gmail API con OAuth 2.0.
- Tabelle principali: `annunci`, `annunci_candidati`.
- Le credenziali Google e i token OAuth restano lato server; non inserire chiavi segrete nel frontend.

## Raccolta dai portali

L'importazione Gmail elabora notifiche ricevute nella casella collegata. Non equivale a una scansione diretta e universale dei portali immobiliari. Le integrazioni dirette devono utilizzare API, feed o accordi autorizzati con ciascun portale, rispettandone condizioni d'uso e limiti tecnici.

## Pubblicazione

L'app è pubblicata su GitHub Pages:
https://nicholasmagi.github.io/nicholas-magi-real-estate/
