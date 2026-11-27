# Subito · acquisizione dell'intera ricerca salvata

Stato: **codice pronto e testato, NON attivo**. L'attivazione richiede autorizzazioni esplicite, dopo la prova reale descritta in fondo.

## Come funziona
1. **Riconoscimento della ricerca.** L'email di Subito («<ricerca> ha N nuovi annunci per te») è solo il segnale.
   - La ricerca si riconosce dal link del pulsante (`subitoSavedSearchDigest`).
   - Chiave stabile: percorso e filtri, senza campagna, ordinamento e pagina.
2. **Filtro sugli inserzionisti preservato e controllato.**
   - Il link viene richiesto con tutti i suoi parametri, compreso `advt`.
   - Ogni pagina (la prima e le successive) deve dichiarare gli stessi filtri della ricerca (`subitoPageConfirmsSearch`), altrimenti viene rifiutata: per esempio un redirect che perde il filtro privati.
   - Lo stato del filtro (`privati`, `non_privati`, `non_rilevato`, da `/da-privati/` o `advt`) viene registrato.
   - Il filtro **non classifica mai da solo**: nella pagina reale del 26/11, filtrata per privati, compaiono anche annunci che Subito indica come professionali.
3. **Acquisizione completa** (`fetchWholeSubitoSearch`):
   - si legge la pagina 1, poi le pagine 2…N con `o=N`, fino al numero di pagine dichiarato (`items.totalPages`);
   - ogni pagina deve dichiarare il proprio numero (`search.page`) e contenere annunci nuovi, altrimenti la lettura si ferma («parziale»);
   - pausa di 1,5 s tra le pagine;
   - limiti: 10 pagine per ricerca e 12 per ciclo; le ricerche più ampie vengono completate nei cicli successivi.
4. **Nessun aggiramento.** HTTP 401, 403 o 429, CAPTCHA ed errori di rete sono errori registrati. La ricerca resta in attesa di recupero:
   - scheda riepilogativa con il motivo in Opportunità;
   - fino a 6 tentativi;
   - nessuna importazione simulata.
5. **Deduplicazione prima di creare:**
   - ID Subito in Opportunità e in Archivio (anche nel cestino);
   - confronto secondario (comune, prezzo e superficie) solo come segnalazione.
6. **Inserzionista** (stessa regola nel server e nell'importatore manuale da browser):
   - «Privato» solo se Subito indica un privato per **quel** annuncio (`advertiser.company = false`) e il testo non contiene riferimenti professionali (agenzia, provvigione, mediazione, marchi immobiliari; esclusi «no agenzie» e simili);
   - professionista, riferimenti professionali o tipo non indicato: «Da verificare»;
   - l'assenza della dicitura «Agenzia» non basta.
7. **Annunci già presenti:**
   - si completano solo i campi vuoti;
   - note, contatti, classificazione e stato non vengono toccati;
   - lo storico delle notifiche si aggiorna solo se il prezzo cambia.
8. **Registro** `nmre_subito_ricerche_sync`: una riga per email, visibile nel monitor.
9. **Idempotenza:**
   - email rielaborata o più email della stessa ricerca: nessun doppione;
   - un errore lascia fermo il cursore Gmail.

## Notifiche: gestione controllata della prima sincronizzazione
**Rischio.** La prima sincronizzazione della ricerca reale (263 annunci, 9 pagine) creerebbe 263 schede in pochi secondi. Con una notifica per scheda, sarebbero 263 notifiche push contemporanee. Lo stesso accadrebbe alla ripresa dopo un lungo blocco di Subito.

**Gestione:**
- **Fino a 10 nuove schede per sincronizzazione:** ognuna ha la sua normale notifica di nuova opportunità.
- **Oltre 10:**
  - tutte le schede vengono create comunque, nessuna opportunità persa, con `dati_estratti.subito.notifica_raggruppata = true`;
  - una sola **scheda riepilogativa della ricerca** («Ricerca salvata Subito · <nome> · 263 nuove opportunità») genera **una** notifica normale.
- **Rielaborazione** della stessa email: nessuna nuova scheda e nessuna nuova notifica.
- **Ricerca letta in più cicli (oltre 10 pagine):** la scheda riepilogativa esiste già e viene aggiornata senza una seconda notifica. Le schede dei cicli successivi entrano in Nuove opportunità senza notifica singola.

**Prerequisito.** La condizione del trigger nella migrazione in attesa `20261126210000_quiet_unproven_subito_candidates.sql`, estesa a `notifica_raggruppata`. **Senza questa migrazione ogni scheda genererebbe la propria notifica**: per questo è un prerequisito dell'attivazione, non facoltativo.

L'importatore manuale da browser crea schede con `novita_non_dimostrata = true`:
- dopo la stessa migrazione, le schede importate a mano non generano notifiche singole;
- finché la migrazione non è applicata, ogni scheda importata a mano genera la propria notifica, come oggi.

## Unificazione dei duplicati
`planSubitoDuplicateMerge` prepara il piano per due schede con lo stesso ID Subito:
- completa i campi vuoti e conserva i valori diversi;
- sposta lo storico e non cancella nulla;
- non scrive: l'applicazione richiede una conferma nell'app ed è rinviata allo schema reale.

## Prova reale: autorizzazioni e operazioni necessarie
Nessuna di queste operazioni è stata eseguita. Vanno autorizzate una per una, nell'ordine.

**Fase A · prova senza scritture** (verifica se Subito restituisce l'intera ricerca alla funzione Supabase):

| # | Operazione | Autorizzazione necessaria | Effetto sulla produzione |
|---|---|---|---|
| A1 | Verifica in sola lettura del corpo di `nmre_get_gmail_tokens` (SQL nel README della prova, passo 1) | Esecuzione di una query di sola lettura nel SQL Editor | Nessuno |
| A2 | Migrazione `20261126200000_gmail_tokens_rpc_stable.sql` (solo volatilità STABLE) | **Applicazione di una migrazione** | Cambia solo la volatilità della funzione dei token; rollback disponibile |
| A3 | Distribuzione di `nmre-subito-dry-run` dal ramo `ale/nmre-release-integration`, con verifica JWT attiva | **Deploy di una funzione Edge** (solo questa; `nmre-gmail-scheduled` non viene toccata) | Nuova funzione, sola lettura |
| A4 | Esecuzione della prova `modalita: "intera_ricerca"` sull'email del 26/11 (README della prova, passo 7-bis) | Esecuzione dalla Console del browser con la sessione del titolare | Nessuna scrittura (garanzia verificata dalla risposta) |
| A5 | Lettura del rapporto: esito, pagine lette/dichiarate, HTTP di ogni pagina, schede che verrebbero create, notifiche previste | — | — |

Esito di A4:
- **`ricerca_letta_completa`:** il recupero dell'intera ricerca è verificato e si può valutare la fase B.
- **`ricerca_non_disponibile`** (403): l'automazione non può funzionare da Supabase e non va attivata. Resta l'importatore manuale da browser.

**Fase B · attivazione** (solo dopo A4 riuscita e una nuova autorizzazione):

| # | Operazione | Autorizzazione necessaria |
|---|---|---|
| B1 | Migrazione `20261126210000_quiet_unproven_subito_candidates.sql` (notifica unica: condizione del trigger) | **Applicazione di una migrazione** |
| B2 | Migrazione `20261127020000_subito_search_sync_log.sql` (registro, nuova tabella) | **Applicazione di una migrazione** |
| B3 | Merge della PR #80 e distribuzione di `nmre-gmail-scheduled` e dell'app (Pages) | **Merge e deploy** |
| B4 | Impostazione `NMRE_SUBITO_FULL_SEARCH=true` sulla funzione `nmre-gmail-scheduled` | **Modifica di un secret/variabile di produzione** |
| B5 | Controllo della prima sincronizzazione: registro «Ricerche Subito», una sola notifica riepilogativa, schede in Nuove opportunità | — |

**Rollback:**
1. rimuovere `NMRE_SUBITO_FULL_SEARCH`: il comportamento torna quello attuale;
2. rollback del registro: l'accesso dell'app viene ritirato e i dati restano;
3. rollback della condizione del trigger.

Le schede già create restano e non vengono cancellate.

## Limiti noti
- Il recupero reale dell'intera ricerca **non è ancora verificato**: dal container di sviluppo subito.it non è raggiungibile, e in passato la funzione Supabase ha ricevuto HTTP 403. La fase A serve a verificarlo.
- Che `o=N` selezioni la pagina N è controllato sulla risposta (`search.page`), non ancora su una risposta reale.
