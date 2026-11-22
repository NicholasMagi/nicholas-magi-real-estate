# Pipeline di importazione Gmail: stato e prossimi passi

## Stato nel branch di sviluppo

Il codice della Edge Function `nmre-gmail-reader` fornito e verificato durante lo sviluppo è stato integrato con il parser conservativo:
- recupera fino a 10 email della posta in arrivo degli ultimi 30 giorni;
- richiede a Gmail il payload completo del messaggio;
- estrae le parti MIME `text/plain` e, se assenti, `text/html`;
- propone titolo, comune, prezzo, dominio sorgente e URL;
- conserva il mittente della notifica separato dal contatto del venditore;
- mantiene sempre `tipo_venditore = "Da verificare"`;
- restituisce candidati e avvisi, senza salvarli automaticamente.

Nel branch è stata aggiunta una coda persistente basata su `public.annunci_candidati`:
- importa solo messaggi il cui contenuto presenta indicatori testuali di una notifica immobiliare;
- usa `upsert` con vincolo `owner_id,dedup_key` e ignora i duplicati già presenti;
- ricarica dalla tabella i candidati con stato `da_verificare`;
- permette di modificare i campi, scartare il candidato o confermarlo;
- la conferma usa la funzione SQL `nmre_confirm_annuncio_candidato`, che crea l'annuncio e aggiorna il candidato in un'unica transazione, con protezione contro conferme ripetute.

La nuova funzione SQL è nella migrazione `supabase/migrations/20261122190000_confirm_gmail_candidate.sql`. **Deve essere eseguita sul progetto Supabase prima di distribuire la versione applicativa di questo branch.** Il codice non è ancora stato distribuito e non è attiva alcuna scansione pianificata.

## Flusso attuale

1. L'utente avvia manualmente il test di lettura Gmail.
2. La funzione legge fino a 10 messaggi in inbox degli ultimi 30 giorni.
3. Il parser produce candidati con una chiave di deduplicazione preliminare.
4. La pagina mostra i candidati e i campi modificabili.
5. L'utente verifica fonte, URL, comune, prezzo e venditore.
6. Solo dopo conferma esplicita il frontend invia i campi a `nmre-search-engine`.

## Contratto candidato

Il parser produce:
`messageId`, `deduplicationKey`, `titolo`, `comune`, `prezzo`, `contatto`, `notificationSender`, `tipo_venditore`, `portale`, `url`, `allUrls`, `receivedAt`, `reviewStatus`, `warnings`.

Il mittente dell'email non viene inserito come contatto del venditore: è normalmente il portale che invia la notifica.

## Limiti e precauzioni

- Le email dei portali non hanno un formato standard: le estrazioni sono suggerimenti, non dati certificati.
- Il primo URL trovato può essere un link di tracciamento o un collegamento secondario: va controllato.
- Il filtro di rilevanza usa parole chiave generiche e può non riconoscere alcune notifiche atipiche oppure includere messaggi non pertinenti: serve la prova con email reali.
- Il vincolo univoco persistente è `(owner_id, dedup_key)` nella tabella `annunci_candidati`; URL di tracciamento diversi possono ancora produrre chiavi diverse.
- Il parser non scarica allegati.
- Nessuna classificazione automatica come "Privato" o "Agenzia".
- Nessuna importazione automatica definitiva.
- La funzione distribuita su Supabase non è stata modificata da questo lavoro su GitHub.

## Prima del rilascio

1. Eseguire i test Deno e la verifica dei tipi.
2. Provare il parser con notifiche reali rappresentative, oscurando dati personali.
3. Verificare il codice effettivo della Edge Function di salvataggio e le policy RLS.
4. Eseguire la migrazione SQL per creare la funzione atomica di conferma.
5. Verificare che le colonne e le policy RLS della tabella candidati corrispondano al contratto atteso.
6. Solo dopo approvazione, distribuire la nuova Edge Function e la versione frontend, quindi verificare il flusso end-to-end.

Il progetto Google OAuth è ancora in modalità di test: la continuità dei token deve essere risolta prima di promettere un servizio 24/7.
