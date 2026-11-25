# A.1 · Nessuna opportunità persa

Rapporto tecnico e proposta · 26/11/2026 · branch `claude/confident-knuth-yvuju7`.

> **Regola fondamentale del progetto:** meglio 100 annunci in più da verificare
> che un solo proprietario privato perso per un errore dell'algoritmo. Prima si
> protegge ogni opportunità, poi si migliora l'intelligenza del classificatore.

Stato: la **patch di Fase 1** è pronta sul branch, con test. Non è distribuita:
nessun deploy, merge, migrazione o modifica alla produzione. Le Fasi 2 e 3 sono
proposte da approvare.

Legenda delle fonti:
- ✅ **Codice**: verificato leggendo il repository.
- ▶️ **Esecuzione**: verificato eseguendo il codice reale su email **sintetiche** (nessun dato reale).
- 🟢 **Produzione**: verificato dal titolare in sola lettura.
- ⚠️ **Ipotesi**: da confermare.
- 🔎 **Da verificare**: query o controllo indicati.

I numeri di riga si riferiscono alla versione **prima della patch** (commit
`c5b848f`), salvo dove indicato "dopo la patch".

---

## 1. Risultati di produzione (26/11, sola lettura)

| Query | Risultato 🟢 |
|---|---|
| AQ2 · 104 candidati scartati | 63 "Da verificare" manuali o storici non determinabili · 14 "Da verificare" con lo stesso URL di uno scarto precedente (D2 o D4, non distinguibili) · 11 "Da verificare" probabilmente scartati dalla sincronizzazione (D1) · 16 "Agenzia" classificati manualmente (D3) |
| AQ4 · testi conservati | Nessun segnale esplicito di privato o proprietario negli 88 "Da verificare" scartati; un solo riferimento a una forma societaria. Tra i confermati Casa.it, un "Privato" e un "Da verificare" contengono la parola "privato": **non sono prove sufficienti** per cambiare la classificazione automatica |
| AQ9 · 48 ore | 508 notifiche immobiliari, tutte "Da verificare"; 0 privati riconosciuti; **0 escluse come agenzia**; 59 inserimenti e 449 aggiornamenti; 0 scarti automatici della sincronizzazione; 0 archiviazioni automatiche |

**Correzione:** la stima precedente di circa 163 email escluse come agenzia
**non è confermata**: AQ9 riporta zero esclusioni come agenzia. Non va più usata.

**Cosa i dati non dicono:** AQ9 conta solo le email che hanno **superato** il
filtro avvisi. Le email escluse dal filtro prima del salvataggio non compaiono
in nessun contatore di esito (vedi L7): oggi non sappiamo quante siano. La
query AQ10 (nuova) le stima per differenza.

---

## 2. Dove NMRE può perdere un'opportunità

### 2.1 Prima del salvataggio: il filtro avvisi `propertyEmail()`
`supabase/functions/nmre-gmail-scheduled/_shared/parser.ts:252-266`

Ogni email letta passa da questo filtro. Se il filtro la esclude, **non viene
salvato nulla**: nessun candidato e nessuna riga di storico. L'email resta in
Gmail, perché l'accesso è in sola lettura.

Comportamento verificato ▶️ con email sintetiche (i casi sono ora test
automatici in `property_filter_test.ts`):

| ID | Caso sintetico | Esito attuale | Causa tecnica |
|---|---|---|---|
| L1 | Avviso valido con "Hai dimenticato la **password**?" nel piè di pagina | **Escluso** | L'elenco di esclusione (riga 255) viene cercato in **tutto** il testo (riga 256), non solo nell'oggetto |
| L1 | Avviso con "Disiscriviti dalla **newsletter**" | **Escluso** | Come sopra |
| L1 | Avviso con "Ricevi **promozioni**" | **Escluso** | Come sopra |
| L1 | "Trilocale vicino al **Tribunale**" | **Escluso** | "tribunale" serve a escludere le aste, ma vale anche come riferimento geografico |
| L1 | "**Benvenuto** nella tua nuova casa" | **Escluso** | "benvenuto" serve a escludere le email di registrazione |
| L2 | "**Il prezzo è sceso**", con link alla scheda | **Escluso** | Lo schema degli avvisi (riga 257) riconosce solo formule tipo "nuovo annuncio" / "annunci pubblicati" |
| L2 | "**Abbiamo trovato 3 case per te**" | **Escluso** | Come sopra |
| L3 | Scheda diretta + link di tracciamento che contiene una pagina di **ricerca** | **Escluso** | Il link annidato ha punteggio 1400 (riga 219), la scheda diretta 1200 (riga 211): vince la ricerca e l'email viene scartata come "link generico" (righe 259-264) |
| L4 | Link di tracciamento di un dominio non in elenco (es. servizi di invio email) | **Escluso** | `listingUrls()` (righe 187-229) ignora i domini che non sono portali né tracker riconosciuti |
| — | Avviso ordinario con scheda diretta | Accettato | — |

**Rischio:** alto e oggi **non misurato**. Il caso L2 è particolarmente grave
per l'obiettivo commerciale: un avviso di ribasso su un annuncio seguito viene
perso prima ancora di essere salvato.
⚠️ Non sappiamo quante email reali rientrino in questi casi: dipende dai testi
effettivi dei portali. La patch aggiunge la misurazione (§3, punto 8).

### 2.2 Durante il salvataggio

| ID | Punto | File e righe | Comportamento effettivo | Rischio |
|---|---|---|---|---|
| L5 | **Email con più annunci** | `index.ts:578` (un candidato per email), `:645` (`dedup_key = gmail:<id>`), `:853` (storico unico per email) | ✅▶️ Di un'email "3 nuovi annunci" viene salvato **solo il primo** link (`listingUrl` restituisce il primo). Gli altri annunci non esistono per NMRE | **Alto** se i portali inviano avvisi multipli (frequente nei riepiloghi) ⚠️ |
| L6 | Email in Spam o Cestino | `index.ts:520-523` | ✅ Ignorate senza segnalazione | Medio: un avviso finito nello spam è perso |
| L7 | Esclusioni senza traccia | `index.ts:524` | ✅ Le email escluse dal filtro (2.1) non lasciano alcun record né contatore di motivo | Alto: impedisce di misurare L1–L4 |
| L8 | **Scarto automatico della sincronizzazione (D1)** | `index.ts:540-562` | ✅ Un candidato già salvato la cui email, riletta, non supera più il filtro o risulta agenzia diventa `scartato`; inoltre mittente e oggetto vengono azzerati. Nessun motivo registrato. 🟢 11 casi storici probabili; 0 nelle ultime 48 ore | **Alto**: viola la regola "un da verificare non si scarta mai in automatico" |
| L9 | **Agenzie non salvate** | `index.ts:538` | ✅ Le email classificate come agenzia alla prima lettura non vengono salvate. 🟢 0 casi nelle ultime 48 ore | Medio oggi, alto se le regole cambiano: l'errore non è recuperabile |
| L10 | Declassamento automatico ad Agenzia | `index.ts:709-716` | ✅ Un candidato in coda può essere riclassificato "Agenzia" da una nuova email dello stesso immobile e uscire dalla coda | Medio |
| L11 | Registro venditori: corrispondenza per sottostringa | `index.ts:316-321` | ✅ Un'identità registrata di almeno 5 caratteri viene cercata come **sottostringa** del testo. Un identificativo generico (un cognome comune, una parola) può classificare email estranee | Medio ⚠️ (dipende dal contenuto del registro, 🔎 AQ14) |
| L16 | Rielaborazione ripetuta delle copie storiche | `index.ts:749-755` con `:503-504`; `:492` | ✅ Una copia storica dello stesso immobile riceve solo `deduplication_version`: se la sua versione di estrazione è inferiore a 6, resta idonea e **viene riletta da Gmail a ogni sincronizzazione**. Il limite di 200 senza ordinamento può escludere altri candidati a tempo indeterminato | Medio (costo e ritardi); 🔎 AQ6 per l'entità reale |
| L17 | Messaggi Gmail non più esistenti | `index.ts:263` (404 → `null`) | ✅ Il candidato da rielaborare resta idoneo e viene richiesto a ogni ciclo | Basso |

### 2.3 Dopo il salvataggio: interfaccia e stati

| ID | Punto | File e righe | Comportamento effettivo | Rischio |
|---|---|---|---|---|
| L12 | **Scarto automatico in interfaccia (D2)** | `index.html:5034-5069` | ✅ A ogni caricamento della coda (ogni 60 s ad app aperta) ogni candidato con lo stesso URL canonico di uno scartato diventa `scartato` e viene nascosto, senza conferma né motivo. 🟢 14 casi compatibili | **Alto** |
| L13 | **Ribasso nascosto da uno scarto precedente** | backend `index.ts:687-689`; interfaccia `index.html:4979` e L12 | ✅ Se la nuova notifica riguarda un immobile già scartato: (a) il backend **non aggiorna** il candidato (la notifica con il ribasso viene salvata nello storico, ma resta collegata a un candidato invisibile); (b) lo storico prezzi viene caricato solo per i candidati in coda; (c) se nasce un nuovo candidato con lo stesso link, L12 lo scarta | **Alto**: un ribasso è il momento migliore per ricontattare un proprietario |
| L14 | Scarti senza motivo, data, autore | D1, D2, D4 (`index.html:5376-5381`) | ✅ Si aggiornano solo `stato` e `updated_at`. D3 (`index.html:5232-5244`) registra solo l'evidenza del venditore | Alto per la tracciabilità |
| L15 | Nessuna vista degli scartati e delle agenzie | — | ✅ Non esiste un'interfaccia per vedere o recuperare un candidato scartato | Alto: un errore non è correggibile senza SQL |
| L18 | Candidati senza ID email non mostrati | `index.html:4959` | ✅▶️ La coda richiede `source_email_id`: un candidato senza email (per esempio da future API) non compare mai | Basso oggi, medio con nuove fonti |

### 2.4 Il classificatore dei venditori
`_shared/parser.ts:300-322`. **Nessuna regola è stata modificata.**

**Espressioni non riconosciute come privato** ▶️ (restano "Da verificare",
quindi nessuna perdita, ma nessuna priorità né archiviazione automatica):
"Annuncio **da privato**" (singolare), "**Privato**" da solo come etichetta,
"Vendita diretta **dal** proprietario", "**Nessuna agenzia**".

**Falsi "Agenzia" possibili** ▶️:
- "Contatta l'agenzia immobiliare più vicina. Annuncio da privato" → **Agenzia**.
  Un piè di pagina generico basta, perché il segnale di privato al singolare non
  viene riconosciuto e quindi non c'è "segnale contrastante".
- "Vendi casa da privato su … Inserzionista: Studio Immobiliare …" → Agenzia,
  qui correttamente.
- 🟢 Oggi il caso non si presenta: 0 agenzie nelle ultime 48 ore.

**Rischi di un ampliamento delle regole**

| Ampliamento | Falsi positivi attesi | Conseguenza | Mitigazione |
|---|---|---|---|
| Riconoscere "privato" isolato | "parcheggio **privato**", "giardino **privato**", "trattativa **privata**" (▶️ oggi correttamente "Da verificare") | Un'agenzia classificata "Privato" verrebbe **archiviata automaticamente** | Le nuove regole producono "**Probabile privato**" (priorità alta, resta "Da verificare"), mai "Privato" |
| Riconoscere "da privato" singolare | Inviti dei portali come "Vendi casa da privato" o "Pubblica il tuo annuncio da privato" | Come sopra | Come sopra, più l'esclusione dei testi di servizio dei portali |
| Rafforzare i segnali di agenzia | Piè di pagina generici con "agenzia" | **Un privato nascosto**: è l'errore da evitare | Le regole di agenzia restano strette; ogni esito "Agenzia" resta recuperabile (Fase 1) |

**Principio proposto (asimmetrico):** le regole possono **alzare la priorità**
di un candidato automaticamente, ma non possono **nasconderlo**. Prima di
qualsiasi modifica servono un corpus etichettato (revisione AQ8 del titolare più
casi sintetici) e la misura di falsi positivi e falsi negativi. Criterio di
accettazione: **zero privati classificati come agenzia** sul corpus.

---

## 3. Patch di Fase 1 (pronta sul branch, non distribuita)

**Obiettivo:** proteggere ogni opportunità **senza** modifiche allo schema del
database e **senza** cambiare le regole di classificazione o del filtro.

| # | Regola richiesta | Cosa cambia | File (dopo la patch) | Risolve |
|---|---|---|---|---|
| 1 | Un "Da verificare" non viene mai scartato automaticamente | Rimosso lo scarto della sincronizzazione (D1). Il candidato la cui email non supera più il filtro resta nel suo stato; si registrano la regola e la data in `dati_estratti.storico_stato` e lo si marca come elaborato | `nmre-gmail-scheduled/index.ts`, blocco "Nessuno scarto automatico" | L8 |
| 2 | Un'agenzia deve essere recuperabile | Le email classificate come agenzia vengono **salvate** come candidati "Agenzia" (fuori dalla coda principale). Interruttore `NMRE_KEEP_AGENCY_CANDIDATES=false` per tornare indietro | `index.ts` (variabile `keepAgency`), `_shared/retention.ts` | L9 |
| 3 | Nessun declassamento automatico | Un candidato in coda non diventa mai "Agenzia" da solo: resta "Da verificare" con l'evidenza "Nuovi segnali di agenzia (…)" | `sellerFieldsForExisting` | L10 |
| 4 | Uno scarto non nasconde un ribasso | Una nuova notifica con **ribasso documentato** su un candidato scartato lo riporta "da verificare" con il motivo registrato | `shouldReopenDiscarded` e blocco "riaperto_per_ribasso" in `index.ts` | L13 (a) |
| 5 | Nessuno scarto automatico in interfaccia | Rimosso D2. Gli annunci con lo stesso link di uno scartato restano in coda con il contrassegno "Già scartato in passato · verificare" (più "nuovo ribasso", se presente) | `index.html`, funzione `loadCandidates` | L12, L13 (c) |
| 6 | Ogni scarto ha motivo, data e autore | Scarto manuale: richiesta del motivo; scarto, classificazione manuale, recupero e decisioni automatiche scrivono una voce in `dati_estratti.storico_stato` (`data`, `origine` utente/sincronizzazione, `azione`, `da`, `a`, `motivo`, `regola`) | `nmreUpdateCandidateWithHistory`, `discardCandidate`, `saveCandidateSeller` | L14 |
| 7 | I dubbi restano visibili e recuperabili | Nuovo pannello "**Annunci fuori dalla coda**" nella sezione Nuove opportunità, con filtro per origine (stessa logica di AQ2), motivo, link all'annuncio e pulsante "**Riporta in revisione**" | `index.html`, `renderCandidateRecovery`, `recoverCandidate` | L15 |
| 8 | Misurare le esclusioni | `propertyEmailDecision()` restituisce il nome della regola che esclude un'email, con comportamento **identico** al precedente (espressioni regolari verificate carattere per carattere). Conteggi per regola nei log e nella risposta della funzione, senza testi | `_shared/parser.ts`, `index.ts` (`propertyFilterRules`) | misura L1–L4, L7 |
| 9 | Nessuna rielaborazione inutile | Le copie storiche e le email non più riconosciute vengono marcate con le versioni attuali; rielaborazione dal più vecchio | `processedVersionMark`, `index.ts` (query di rielaborazione) | L16 |
| 10 | Lo storico non si perde | Quando una nuova estrazione sostituisce `dati_estratti`, lo storico delle decisioni viene conservato | `preserveStatusHistory` | — |

**Garanzie della patch**
- Nessuna cancellazione: nessun `delete`; nessun campo viene azzerato. Lo scarto
  D1, che azzerava mittente e oggetto, è stato rimosso.
- Nessuna modifica di schema: usa solo colonne esistenti (`dati_estratti` è
  JSON). Evita il rischio "funzione distribuita prima della migrazione"
  dell'episodio del 24/11.
- Le classificazioni manuali non vengono mai toccate dalla sincronizzazione.
- Regole del classificatore e del filtro **invariate**.

**Effetti attesi**
- La coda principale può crescere: tornano visibili gli annunci "già scartati in
  passato" (fino a 14 casi oggi) e quelli riaperti per ribasso. È voluto.
- Le agenzie, se arrivano, sono visibili nel pannello e non nella coda.
- `discarded_existing_count` resterà a 0. `excluded_agencies_count` conterà le
  agenzie **salvate** fuori dalla coda.

**Limiti noti della Fase 1**
- Una nuova notifica **senza** ribasso su un annuncio scartato resta collegata al
  candidato scartato (salvata, non visibile in coda). Risolto in Fase 2 con
  l'indicatore "nuove notifiche dopo lo scarto".
- Lo storico è in `dati_estratti`: lettura e scrittura non sono atomiche.
  L'interfaccia rilegge il valore subito prima di scrivere, ma una
  sincronizzazione nello stesso istante potrebbe perdere una voce di storico, mai
  lo stato. In Fase 2 lo storico passa a una tabella dedicata.
- Con la conferma in archivio, la RPC copia `dati_estratti` (storico incluso)
  nell'annuncio: è innocuo, ma va saputo.
- L1–L7 sono **misurati**, non ancora corretti.

### 3.1 Verifiche pre-distribuzione (🔎, sola lettura)
1. **AQ11**: i vincoli di `annunci_candidati` ammettono la combinazione
   `tipo_venditore = 'Agenzia'` con `stato = 'da_verificare'` (oggi non si
   presenta mai).
2. **AQ12**: trigger su `annunci_candidati`. Se un trigger genera la notifica push
   "Nuove opportunità" a ogni inserimento, anche le agenzie salvate la
   genererebbero. Non è una perdita, ma rumore. In quel caso si valuta di
   distribuire con `NMRE_KEEP_AGENCY_CANDIDATES=false` finché il trigger non
   filtra per tipo.
3. **AQ6**: entità reale delle rielaborazioni ripetute, da confrontare dopo la
   distribuzione.

### 3.2 Ordine di distribuzione (dopo approvazione)
1. `nmre-gmail-scheduled` (funzione). Verifica: risposta 200, campi
   `keptForReview`, `reopenedOnPriceDrop`, `propertyFilterRules` presenti; nessun
   errore per 24 ore.
2. Frontend (merge su `main` → GitHub Pages; aggiornare la versione del service
   worker). Verifica: coda, contrassegno, pannello di recupero.
3. Solo dopo 1 e 2, la procedura di recupero (§5). Prima di allora un candidato
   recuperato potrebbe essere scartato di nuovo da D1 o D2.

**Ritorno indietro:** ridistribuire la versione precedente della funzione
(Dashboard → Edge Functions), oppure `NMRE_KEEP_AGENCY_CANDIDATES=false` per la
sola conservazione delle agenzie; revert del commit del frontend. I dati scritti
nel frattempo restano e non devono essere rimossi.

---

## 4. Test

### 4.1 Automatici (eseguiti su questo branch)
| Suite | Esito |
|---|---|
| `parser_test.ts`, `history_test.ts`, `_shared/parser.test.ts` (esistenti) | 18 superati |
| `retention_test.ts` (nuovo): niente declassamento ad agenzia, manuali intoccabili, riapertura su ribasso, idoneità alla rielaborazione invariata, fine del ciclo di rielaborazione, versioni mai abbassate, storico additivo e limitato, storico conservato nelle nuove estrazioni, interruttore agenzie | 12 superati |
| `property_filter_test.ts` (nuovo): equivalenza con il filtro precedente, veri negativi, **falsi negativi noti L1–L4 documentati** | 7 superati |
| `nmre-insights-sync/provider_test.ts` | 6 superati |
| `deno check` di `nmre-gmail-scheduled` e `nmre-gmail-push` | superato |
| Sintassi JavaScript di `index.html`, ID univoci, ID referenziati esistenti | superati |
| Funzioni del frontend (storico, raggruppamento del recupero) eseguite in Node | superate |
| **Prova end-to-end in Chromium** con Supabase simulato e dati sintetici: coda, contrassegno "già scartato", agenzia fuori dalla coda ma nel pannello, recupero con storico che conserva gli altri campi, scarto manuale con motivo | superata, nessun errore di pagina |

Il workflow CI è stato esteso ai due nuovi file di test e a
`_shared/parser.test.ts`. Non è stato possibile eseguire qui `deno check` di
`nmre-search-engine`: `esm.sh` non è raggiungibile da questo ambiente. Il file non
è modificato.

### 4.2 Da eseguire prima o dopo la distribuzione
- In locale o su un progetto di prova, con lo schema di base (P0, §7): ciclo
  completo con un'email agenzia, un ribasso su uno scartato e un'email riletta
  non più riconosciuta, verificando stati e storico nel database.
- In produzione, per 7 giorni: `propertyFilterRules` (quante email per regola),
  `keptForReview`, `reopenedOnPriceDrop`, nessuna crescita di AQ6, tasso di
  errore sotto lo 0,5%.

---

## 5. Procedura di recupero degli 88 "Da verificare" scartati

**Principi:** nessuna riattivazione in blocco alla cieca; ogni recupero è
singolo, motivato, registrato e reversibile. Nessun URL, identificativo o dato
personale entra nel repository: la revisione avviene nel pannello dell'app o con
AQ8 per uso personale.

**Prerequisito:** patch di Fase 1 distribuita (§3.2), altrimenti D1 e D2
potrebbero scartare di nuovo gli annunci recuperati.

| Passo | Azione | Reversibilità |
|---|---|---|
| 0 | (Facoltativo, **scrittura da approvare**) istantanea tecnica degli stati attuali, con le sole colonne `id, stato, tipo_venditore, seller_manual_override, updated_at`, in una tabella dello schema `private`. Comando in §5.1 | Non modifica i candidati |
| 1 | Aprire "Nuove opportunità" → **Annunci fuori dalla coda** | Sola lettura |
| 2 | Filtro "**Scartati dalla sincronizzazione (probabile)**" (gli 11): sono i più probabili errori dell'algoritmo. Aprire l'annuncio, valutare, eventualmente "**Riporta in revisione**" con un motivo | Il candidato può essere scartato di nuovo, con motivo; lo storico conserva entrambe le decisioni |
| 3 | Filtro "**Scartati con lo stesso link di uno scarto precedente**" (i 14): verificare se lo storico notifiche mostra un ribasso o una ripubblicazione | Come sopra |
| 4 | Filtro "**Scartati manualmente o storici**" (i 63): sono decisioni del titolare o operazioni storiche. Revisione a campione con AQ8 (gruppo A) e recupero solo dei casi dubbi | Come sopra |
| 5 | "**Classificati manualmente come agenzia**" (i 16): solo se la revisione AQ8 (gruppo B) trova errori | Come sopra |
| 6 | Misurare: AQ13 conta i recuperati e le decisioni registrate; i privati trovati entrano nel corpus di test del classificatore (solo come casi sintetici equivalenti, mai con dati reali nel repository) | — |

Cosa fa "Riporta in revisione" (codice `recoverCandidate`): imposta `stato =
da_verificare` solo se il candidato è ancora `scartato`; per un'agenzia porta il
tipo a "Da verificare" con classificazione manuale; aggiunge allo storico data,
origine "utente", azione, stato di partenza e di arrivo, motivo. Non tocca testi,
URL, notifiche o altri dati.

### 5.1 Istantanea facoltativa (NON eseguire senza approvazione)
```sql
-- Scrittura in schema private: copia SOLO colonne tecniche, nessun dato personale.
create table private.backup_candidati_scartati_20261126 as
select id, owner_id, stato, tipo_venditore, seller_manual_override, updated_at
  from public.annunci_candidati
 where stato = 'scartato';
revoke all on table private.backup_candidati_scartati_20261126 from public, anon, authenticated;
```
Non è previsto alcun comando di riattivazione in blocco. Se, dopo la revisione
del gruppo dei 11, il titolare decidesse di riportarli tutti in revisione, il
comando verrà preparato a parte con la condizione esplicita, la registrazione
nello storico e una nuova approvazione.

---

## 6. Modifiche ordinate per priorità

| Priorità | Intervento | Punti | Stato | Dipende da |
|---|---|---|---|---|
| **1** | Patch Fase 1: nessuno scarto automatico, agenzie conservate, niente declassamento, riapertura su ribasso, contrassegno al posto di D2, storico delle decisioni, pannello di recupero, misurazione del filtro, fine delle rielaborazioni inutili | L8, L9, L10, L12, L13a/c, L14, L15, L16, misura L1–L4 e L7 | **Pronta sul branch, con test** | Verifiche 3.1 e approvazione |
| **2** | Recupero guidato degli 88 (§5) | — | Procedura pronta | 1 distribuita |
| **3** | Registro delle esclusioni del filtro: tabella `nmre_gmail_esclusioni` con solo ID Gmail, regola, dominio del portale e data (nessun testo) | L7 | Da progettare (migrazione additiva) | 1 + 7 giorni di misure |
| **4** | Filtro "morbido": le parole di esclusione valgono solo nell'oggetto o nei blocchi di servizio; riconoscimento degli avvisi di ribasso e delle formule alternative; preferenza per la scheda specifica sul link generico; tracker sconosciuti verso un portale non più scartati; nel dubbio "salva per revisione" | L1–L4 | Proposta: richiede la documentazione di falsi positivi e negativi (da misure di 3 e casi sintetici) | 3 |
| **5** | Più annunci per email: un candidato per scheda; chiave dello storico per (email, scheda) | L5 | Proposta: richiede una migrazione dello storico notifiche | 1 |
| **6** | Notifiche successive allo scarto: indicatore "N nuove notifiche dopo lo scarto" nel pannello e nella panoramica; ribassi anche sugli annunci già in archivio | L13 residuo | Proposta | 1 |
| **7** | Storico delle decisioni in tabella dedicata (`annunci_candidati_eventi`), con colonne `scartato_da`, `motivo_scarto`, `scartato_il` | L14 (definitivo) | Proposta (migrazione additiva) | 1 |
| **8** | Registro venditori: confronto a parola intera, lunghezza minima più alta, le corrispondenze "Agenzia" diventano proposte | L11 | Proposta | 1, AQ14 |
| **9** | Avvisi in Spam (conteggio e avviso al titolare); messaggi Gmail non più esistenti marcati come tali; coda aperta ai candidati senza email | L6, L17, L18 | Proposta | 1 |
| **10** | Classificatore: corpus etichettato (AQ8 + sintetici), misura di precisione e richiamo, nuove regole solo come "Probabile privato" | L19, L20 | Dopo 2 e 4 | 2, 4 |

---

## 7. File toccati dalla patch di Fase 1

| File | Modifica |
|---|---|
| `supabase/functions/nmre-gmail-scheduled/_shared/retention.ts` | **Nuovo**: regole pure di conservazione |
| `supabase/functions/nmre-gmail-scheduled/_shared/parser.ts` | `propertyEmailDecision()` diagnostica; `propertyEmail()` invariata nel comportamento |
| `supabase/functions/nmre-gmail-scheduled/index.ts` | Nessuno scarto automatico, agenzie conservate, niente declassamento, riapertura su ribasso, storico conservato, segno di elaborazione, conteggi diagnostici |
| `supabase/functions/nmre-gmail-scheduled/retention_test.ts` | **Nuovo** |
| `supabase/functions/nmre-gmail-scheduled/property_filter_test.ts` | **Nuovo** |
| `index.html` | Rimozione di D2 e contrassegno; agenzie fuori dalla coda; pannello "Annunci fuori dalla coda"; motivo e storico per scarto, classificazione e recupero |
| `.github/workflows/validate-app.yml` | Esecuzione dei nuovi test e di `_shared/parser.test.ts` |
