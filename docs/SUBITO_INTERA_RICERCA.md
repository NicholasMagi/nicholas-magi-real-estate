# Subito · acquisizione dell'intera ricerca salvata

Stato: **codice pronto e testato, NON attivo**. L'attivazione richiede un'approvazione esplicita, dopo la prova reale.

## Come funziona
1. **Riconoscimento della ricerca.** L'email di Subito («<ricerca> ha N nuovi annunci per te») è solo il segnale.
   - La ricerca si riconosce dal link del pulsante (`subitoSavedSearchDigest`).
   - Chiave stabile: percorso e filtri, senza campagna, ordinamento e pagina.
   - Si mantengono tutti i filtri, compreso `advt` (inserzionisti).
   - Se Subito reindirizza a una ricerca con filtri diversi, la pagina viene rifiutata.
2. **Acquisizione completa** (`fetchWholeSubitoSearch`):
   - si legge la pagina 1, poi le pagine 2…N con `o=N`, fino al numero di pagine dichiarato da Subito (`items.totalPages`);
   - ogni pagina deve dichiarare il proprio numero (`search.page`) e contenere annunci nuovi, altrimenti la lettura si ferma (esito «parziale»), senza supposizioni;
   - tra una pagina e l'altra c'è una pausa di 1,5 s;
   - limiti: 10 pagine per ricerca e 12 per ciclo, cioè circa 300 annunci;
   - le ricerche più ampie restano «parziali» e vengono completate nei cicli successivi.
3. **Nessun aggiramento.** HTTP 401, 403 o 429, CAPTCHA, DataDome ed errori di rete sono errori registrati. La ricerca resta **in attesa di recupero**:
   - la scheda della notifica è visibile in Opportunità con il motivo;
   - viene ritentata fino a 6 volte;
   - nessuna importazione viene simulata.
4. **Deduplicazione prima di creare** (`classifyFullSearchItems`):
   - ID Subito in Opportunità (`dedup_key`, `listing_key`, `url`);
   - poi ID Subito in Archivio (`annunci.listing_key` / `url`, anche nel cestino);
   - poi un confronto secondario (stesso comune, prezzo e superficie con ID diverso), che **segnala soltanto** un possibile duplicato.
5. **Import automatico.** Ogni annuncio non presente diventa una scheda in Nuove opportunità (`stato = da_verificare`):
   - si attiva la **normale notifica** di nuova opportunità;
   - nessuna archiviazione automatica.
6. **Inserzionista** (`fullSearchSeller`):
   - «Privato» solo se Subito lo indica per l'annuncio (`advertiser.company = false`) e il testo non contiene riferimenti professionali;
   - professionista indicato da Subito: «Da verificare», mai privato;
   - tipo non indicato: «Da verificare»;
   - il filtro della ricerca da solo non basta.
7. **Annunci già presenti** (`fill_missing`, `sighting_only`):
   - si completano solo i campi vuoti, senza toccare note, contatti, classificazione, stato o valori esistenti;
   - lo storico delle notifiche si aggiorna solo se il prezzo è cambiato.
8. **Registro** (`nmre_subito_ricerche_sync`): una riga per email, aggiornata a ogni rielaborazione. Contiene:
   - ricerca, data e ora;
   - pagine lette e dichiarate;
   - annunci trovati, nuove opportunità, già in Opportunità, già in Archivio, da verificare, professionali;
   - possibili duplicati e duplicati da unificare;
   - esito, motivo e tentativi.

   È visibile nel monitor («Ricerche Subito · ultime sincronizzazioni»).
9. **Idempotenza.**
   - Una stessa email o una stessa ricerca non crea doppioni: chiavi uniche per annuncio e notifica, una sola riga di registro per email.
   - Più email della stessa ricerca nello stesso ciclo generano una sola lettura: le più vecchie risultano «assorbite».
10. **Errori.** Un errore di database su un'email non avanza il cursore Gmail, e nemmeno un registro non salvato. Il ciclo si ripete senza doppioni.

## Unificazione dei duplicati
`planSubitoDuplicateMerge` prepara il piano per due schede con lo **stesso ID Subito**:
- completa i campi vuoti;
- conserva come alternative i valori diversi;
- sposta lo storico;
- **non cancella** il duplicato.

Non scrive nulla: l'applicazione richiede una conferma esplicita nell'app ed è rinviata allo schema reale di produzione. Schede con ID diversi non vengono mai unite.

## Attivazione (solo con autorizzazione)
1. Prova reale: verificare che la funzione Supabase riceva la pagina dei risultati (HTTP 200) e non 403.
2. Applicare `supabase/migrations_pending/20261127020000_subito_search_sync_log.sql` dal SQL Editor.
3. Distribuire `nmre-gmail-scheduled`.
4. Impostare `NMRE_SUBITO_FULL_SEARCH=true`.

Rollback: rimuovere la variabile, poi eseguire il rollback del registro (i dati restano).

## Limiti noti
- Dalla rete del container di sviluppo subito.it non è raggiungibile. In passato la funzione Supabase ha ricevuto HTTP 403 da Subito. **Il recupero reale dell'intera ricerca non è ancora verificato.**
- Che il parametro `o=N` selezioni la pagina N è verificato solo dalla risposta (`search.page`), non da una prova reale.
- La prima sincronizzazione di una ricerca ampia crea una scheda, e quindi una notifica, per ogni annuncio non ancora presente (fino a circa 300 per ciclo).
