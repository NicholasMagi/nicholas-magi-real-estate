# Pipeline di importazione Gmail: stato e prossimi passi

## Stato nel branch di sviluppo

Il codice della Edge Function `nmre-gmail-reader` nel branch di sviluppo:
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
- la conferma chiama direttamente la RPC SQL `nmre_confirm_annuncio_candidato` dal client autenticato;
- la funzione SQL crea l'annuncio e aggiorna il candidato nella stessa transazione, con protezione contro conferme ripetute.

La migrazione `supabase/migrations/20261122190000_confirm_gmail_candidate.sql` crea la funzione RPC. È stata eseguita dall'utente sul progetto Supabase e la sua presenza è stata verificata tramite `information_schema.routines`. **Prima del rilascio occorre ancora verificare i privilegi della funzione e fare un test end-to-end con un candidato di prova.**

Il nuovo codice della Edge Function Gmail nel branch non è ancora distribuito su Supabase. La versione frontend del branch non è ancora pubblicata e non è attiva alcuna scansione pianificata.

## Flusso previsto

1. L'utente avvia manualmente il test di lettura Gmail.
2. La Edge Function legge fino a 10 messaggi in inbox degli ultimi 30 giorni.
3. Il parser produce candidati con una chiave di deduplicazione preliminare.
4. Il frontend salva i candidati riconosciuti nella tabella `annunci_candidati`, usando l'utente autenticato e il vincolo univoco `owner_id,dedup_key`.
5. La pagina ricarica i candidati in attesa e mostra i campi modificabili.
6. L'utente verifica fonte, URL, comune, prezzo e venditore.
7. Solo dopo conferma esplicita il frontend chiama la RPC `nmre_confirm_annuncio_candidato`; la funzione inserisce l'annuncio in `annunci` e marca il candidato come confermato.

## Contratto candidato

Il parser produce:
`messageId`, `deduplicationKey`, `titolo`, `comune`, `prezzo`, `contatto`, `notificationSender`, `tipo_venditore`, `portale`, `url`, `allUrls`, `receivedAt`, `reviewStatus`, `likelyRealEstate`, `warnings`.

Il mittente dell'email non viene inserito come contatto del venditore: è normalmente il portale che invia la notifica.

## Limiti e precauzioni

- Le email dei portali non hanno un formato standard: le estrazioni sono suggerimenti, non dati certificati.
- Il primo URL trovato può essere un link di tracciamento o un collegamento secondario: va controllato.
- Il filtro di rilevanza usa parole chiave generiche e può non riconoscere alcune notifiche atipiche oppure includere messaggi non pertinenti: serve la prova con email reali.
- Il vincolo univoco persistente è `(owner_id, dedup_key)` nella tabella `annunci_candidati`; URL di tracciamento diversi possono ancora produrre chiavi diverse.
- Il parser non scarica allegati.
- Nessuna classificazione automatica come "Privato" o "Agenzia".
- Nessuna importazione automatica definitiva: la conferma è sempre manuale.
- La nuova versione della Edge Function Gmail non è stata ancora distribuita su Supabase.

## Prima del rilascio

1. Verificare i privilegi della RPC e la sua esecuzione con un utente autenticato.
2. Verificare che colonne, vincolo univoco e policy RLS della tabella candidati corrispondano al contratto atteso.
3. Eseguire i test Deno e la verifica dei tipi.
4. Provare il parser con notifiche reali rappresentative, oscurando dati personali.
5. Distribuire la nuova Edge Function Gmail solo dopo approvazione.
6. Pubblicare il frontend solo dopo approvazione e verificare il flusso end-to-end.
7. Risolvere la continuità dei token Google OAuth prima di promettere un servizio 24/7.

Il progetto Google OAuth è ancora in modalità di test: la continuità dei token deve essere risolta prima di promettere un servizio 24/7.
