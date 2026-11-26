# A.1 · Nessuna opportunità persa

Rapporto tecnico e proposta · 25/11/2026 · branch `claude/confident-knuth-yvuju7`.

> **Regola fondamentale del progetto:** meglio 100 annunci in più da verificare
> che un solo proprietario privato perso per un errore dell'algoritmo. Prima si
> protegge ogni opportunità, poi si migliora l'intelligenza del classificatore.

**Stato al 26/11/2026** (Pull Request Draft
[NicholasMagi/nicholas-magi-real-estate#68](https://github.com/NicholasMagi/nicholas-magi-real-estate/pull/68);
lo stato di produzione è quello riferito dal titolare, non verificato da qui):

| Componente | Stato in produzione |
|---|---|
| Migrazione protezione `new_opportunities` | **Applicata**, versione `20261126004257` (file rinominato di conseguenza; nome originale `20261125200000`) |
| Migrazione protezione `price_drop` | **Applicata**, versione `20261126004310` (file rinominato di conseguenza; nome originale `20261125202000`) |
| Edge Function `nmre-gmail-scheduled` | **Versione 68 attiva** |
| Tabella Fase 2 `nmre_gmail_avvisi_dubbi` | **Non applicata**; `NMRE_CAPTURE_DUBIOUS_ALERTS` non impostato. Il file è in `supabase/migrations_pending/`: nessun `db push` può applicarlo |
| Frontend (`index.html`, `sw.js`) | **Non distribuito**: in produzione resta la versione di `main` |

Le versioni dei file delle protezioni sono state riallineate a quelle di produzione e
la Fase 2 è stata spostata fuori dalle migrazioni applicabili (§16.6). Finché il frontend non è
distribuito, quello attuale continua a riscartare i duplicati (§16.5). Le regole
del classificatore e del filtro avvisi sono **invariate**.

Legenda delle fonti:
- ✅ **Codice**: verificato leggendo il repository.
- ▶️ **Esecuzione**: verificato eseguendo il codice reale su dati **sintetici**.
- 🧪 **Database di prova**: verificato su PostgreSQL 16 locale e usa e getta.
- 🟢 **Produzione**: verificato dal titolare in sola lettura.
- ⚠️ **Ipotesi** · 🔎 **Da verificare**.

I numeri di riga dei problemi si riferiscono alla versione **prima della patch**
(commit `c5b848f`).

---

## 1. Risultati di produzione (25/11/2026, sola lettura) 🟢

| Query | Risultato |
|---|---|
| AQ2 · 104 candidati scartati | 63 "Da verificare" manuali o storici non determinabili · 14 "Da verificare" con lo stesso URL di uno scarto precedente (D2 o D4) · 11 "Da verificare" probabilmente scartati dalla sincronizzazione (D1) · 16 "Agenzia" classificati manualmente (D3) |
| AQ4 · testi conservati | Nessun segnale esplicito di privato negli 88 "Da verificare" scartati; un solo riferimento a forma societaria; due casi Casa.it con la parola "privato", **non sufficienti** per cambiare la classificazione |
| AQ9 · 48 ore | 508 notifiche immobiliari, tutte "Da verificare"; 0 privati; **0 escluse come agenzia** (la stima precedente di circa 163 è ritirata); 59 inserimenti, 449 aggiornamenti; 0 scarti e 0 archiviazioni automatiche |
| **AQ10** · 48 ore | **73 letture escluse dal filtro avvisi** prima del salvataggio. Sono **letture, non email distinte**: i contatori sono somme per esecuzione e la stessa email può essere riletta (per esempio dalla rielaborazione). Comprendono sia email non immobiliari legittime sia eventuali avvisi reali esclusi per errore (L1–L4). È un **limite superiore**, non una stima delle perdite |
| AQ11 | Eseguita dal titolare; nessun vincolo bloccante comunicato. 🔎 Da confermare esplicitamente che la combinazione `tipo_venditore = 'Agenzia'` con `stato = 'da_verificare'` sia ammessa |
| **AQ12** | Il trigger con funzione `private.nmre_notify_candidate_insert` è **attivo** e inserisce una notifica `new_opportunities` per **ogni** candidato inserito con stato `da_verificare`, **senza controllare `tipo_venditore`**. Con la conservazione delle agenzie avrebbe generato notifiche indesiderate: risolto in §3.2 |

---

## 2. Dove NMRE può perdere un'opportunità

### 2.1 Prima del salvataggio: il filtro avvisi
`_shared/parser.ts:252-266`. Un'email esclusa dal filtro, prima della patch, non
lasciava **alcuna traccia** in NMRE; resta in Gmail, che è in sola lettura.

| ID | Caso verificato ▶️ (test `property_filter_test.ts`) | Causa tecnica |
|---|---|---|
| L1 | "password", "newsletter", "promozioni" nel piè di pagina; "Tribunale" come riferimento geografico; "Benvenuto nella tua nuova casa" → **escluso** | Elenco di esclusione (riga 255) cercato in tutto il testo (riga 256) |
| L2 | "Il prezzo è sceso", "Abbiamo trovato 3 case per te" → **escluso** | Schema degli avvisi limitato a "nuovo annuncio / annunci pubblicati" (riga 257) |
| L3 | Scheda diretta + link di tracciamento con pagina di ricerca → **escluso** | Il link annidato (punteggio 1400, riga 219) prevale sulla scheda (1200, riga 211) |
| L4 | Link di tracciamento di un dominio sconosciuto → **escluso** | `listingUrls()` ignora i domini non riconosciuti (righe 187-229) |

### 2.2 Durante il salvataggio
| ID | Punto | File e righe | Comportamento |
|---|---|---|---|
| L5 | Email con più annunci | `index.ts:578`, `:645`, `:853` | Solo il primo annuncio viene salvato ✅▶️ |
| L6 | Spam e Cestino | `index.ts:520-523` | Ignorati senza segnalazione ✅ |
| L7 | Esclusioni senza traccia | `index.ts:524` | Nessun record né motivo ✅ |
| L8 | Scarto automatico della sincronizzazione (D1) | `index.ts:540-562` | Candidato reso `scartato`, mittente e oggetto azzerati ✅ |
| L9 | Agenzie non salvate | `index.ts:538` | Irrecuperabili ✅ |
| L10 | Declassamento automatico ad agenzia | `index.ts:709-716` | Un candidato in coda poteva uscire dalla coda ✅ |
| L11 | Registro venditori per sottostringa | `index.ts:316-321` | Un identificativo generico può classificare email estranee ✅ (entità 🔎 AQ14) |
| L16 | Rielaborazione ripetuta | `index.ts:749-755`, `:503-504`, `:492` | Copie storiche rilette a ogni ciclo ✅ (entità 🔎 AQ6) |
| L17 | Messaggi Gmail non più esistenti | `index.ts:263` | Richiesti a ogni ciclo ✅ |

### 2.3 Dopo il salvataggio
| ID | Punto | File e righe | Comportamento |
|---|---|---|---|
| L12 | Scarto automatico in interfaccia (D2) | `index.html:5034-5069` | Nuovi avvisi dello stesso link nascosti e scartati senza conferma ✅ |
| L13 | Aggiornamenti nascosti da uno scarto | `index.ts:687-689`; `index.html:4979` | Una nuova notifica (con o senza ribasso) su un immobile scartato resta invisibile ✅ |
| L14 | Scarti senza motivo, data, autore | D1, D2, D4 (`index.html:5376-5381`) | ✅ |
| L15 | Nessuna vista degli scartati | — | ✅ |
| L18 | Candidati senza ID email non mostrati | `index.html:4959` | ✅▶️ |
| L21 | **Notifiche push per le agenzie** (nuovo, AQ12) | trigger `private.nmre_notify_candidate_insert` | Conservando le agenzie, ognuna avrebbe generato "Nuove opportunità" 🟢 |
| L22 | **Provenienza delle agenzie non distinta** (nuovo) | pannello di recupero, prima versione | Ogni agenzia scartata veniva etichettata come "manuale", anche se decisa da una versione automatica precedente ✅ |
| L24 | **Push di ribasso per le agenzie** (segnalato dal titolare nella revisione della PR) | trigger su `annunci_candidati_notifiche` (produzione) | La sincronizzazione registra nello storico anche le notifiche delle agenzie conservate; con un ribasso (`price_drop_percent`) il trigger separato dei ribassi avrebbe generato una push `price_drop` 🟢 |
| L23 | **Scarto automatico nel connettore Insights** (trovato nella revisione finale) | `nmre-insights-sync/index.ts:381-398` | I candidati "da verificare" che l'API indicava come professionisti diventavano `scartato`. Oggi inattivo (importazione bloccata in attesa dell'autorizzazione scritta), ma contrario alla regola ✅ |

### 2.4 Classificatore (nessuna regola modificata)
Non riconosce come privato ▶️: "Annuncio da privato" (singolare), "Privato"
isolato, "Vendita diretta dal proprietario", "Nessuna agenzia" (restano "Da
verificare": nessuna perdita, ma nessuna priorità). Può marcare un privato come
agenzia ▶️: "Contatta l'agenzia immobiliare più vicina. Annuncio da privato" →
Agenzia (oggi 0 casi in 48 ore 🟢).

**Rischi di un ampliamento:** "privato" isolato colpirebbe "parcheggio privato",
"giardino privato", "trattativa privata"; "da privato" colpirebbe gli inviti dei
portali ("Vendi casa da privato"). Un falso "Privato" verrebbe **archiviato
automaticamente**. Principio proposto (asimmetrico): le regole possono alzare la
priorità ("Probabile privato"), mai nascondere; nessuna modifica senza un corpus
etichettato e la misura di falsi positivi e negativi (criterio: zero privati
classificati come agenzia).

---

## 3. Fase 1 · Protezione (migrazioni e funzione distribuite; frontend non distribuito)

Nessuna modifica di schema **richiesta dal codice**. Una sola migrazione, per il
trigger delle notifiche (§3.2), da applicare **prima** della funzione.

### 3.1 Regole implementate

| # | Regola richiesta | Implementazione | Risolve |
|---|---|---|---|
| 1 | Un "Da verificare" non viene mai scartato automaticamente | Rimosso D1: la sincronizzazione registra regola e data in `dati_estratti.storico_stato` e lascia lo stato invariato | L8 |
| 2 | Un'agenzia deve poter essere recuperata | Agenzie salvate come candidati "Agenzia" fuori dalla coda (`NMRE_KEEP_AGENCY_CANDIDATES=false` per tornare indietro) | L9 |
| 3 | Nessun declassamento automatico | `sellerFieldsForExisting`: il candidato resta "Da verificare" con evidenza "Nuovi segnali di agenzia" | L10 |
| 4 | Uno scarto non nasconde un ribasso | Ribasso documentato su uno scartato → torna "da verificare" con motivo | L13 (ribassi) |
| 5 | **Gli aggiornamenti dello stesso immobile sono sempre visibili** (nuovo) | Nuova notifica **senza ribasso** su uno scartato: resta scartato ma viene registrata in `dati_estratti.notifiche_dopo_scarto` (conteggio, ultima, elenco delle 10 più recenti: data, prezzo, ribasso, titolo, comune, portale; nessun testo) e compare nel pannello con il contrassegno **"Nuova notifica dopo lo scarto"**, la data e le informazioni essenziali. Avviso in cima alla coda: "N annunci scartati hanno nuove notifiche dopo lo scarto" | L13 (tutti gli aggiornamenti) |
| 6 | Presa visione senza recupero (nuovo) | Pulsante "Ho visto: resta scartato": registra la presa visione nello storico; una notifica successiva riaccende il contrassegno | — |
| 7 | Nessuno scarto automatico in interfaccia | Rimosso D2; contrassegno "Già scartato in passato · verificare" | L12 |
| 8 | Ogni scarto ha motivo, data, autore | Storico delle decisioni per scarto, classificazione, recupero, riapertura, presa visione | L14 |
| 9 | I dubbi restano visibili | Pannello "Annunci fuori dalla coda" con filtri e "Riporta in revisione" | L15 |
| 10 | **Provenienza corretta delle agenzie** (nuovo) | Etichette: "Agenzia · classificazione automatica della sincronizzazione" (in attesa), "Agenzia · classificazione manuale" (storico utente, override manuale o evidenza "Verificato manualmente"), "Agenzia · classificazione automatica storica, scartata". La data mostrata è quella **reale** dello scarto, presa dallo storico, non `updated_at`, che cambia a ogni notifica; se manca: "Data dello scarto non registrata" | L22 |
| 11 | **Agenzie senza notifiche push** (nuovo) | Migrazione del trigger (§3.2) | L21 |
| 12 | Misurare le esclusioni | `propertyEmailDecision()` con nome della regola; conteggi nei log; comportamento identico | misura L1–L4, L7 |
| 13 | Nessuna rielaborazione inutile | Copie storiche marcate come elaborate; rielaborazione dalla più vecchia | L16 |
| 14 | Nessuno scarto nel connettore Insights (revisione finale) | Il candidato resta "Da verificare" con l'evidenza "Immobiliare.it Insights indica un professionista: conferma manuale necessaria" | L23 |
| 16 | **Nessuna push di ribasso per le agenzie** | Migrazione `20261125202000_guard_agency_price_drop_notifications.sql` (§3.3). Lo storico dei ribassi resta invariato e visibile nell'app | L24 |
| 15 | Ribasso su un'agenzia scartata (revisione finale) | L'agenzia riaperta per ribasso è evidenziata come "Ribasso dopo lo scarto" e conteggiata nell'avviso in cima alla coda | L13 |

### 3.2 Migrazione del trigger delle notifiche (AQ12)
File: `supabase/migrations/20261126004257_guard_agency_candidate_notifications.sql`
· rollback: `supabase/rollback/20261126004257_guard_agency_candidate_notifications.rollback.sql`.

**Scelta:** la funzione `private.nmre_notify_candidate_insert()` **non viene
riscritta**. Il suo codice non è nel repository e ricostruirlo a memoria
rischierebbe di cambiarne il comportamento. Si aggiunge solo una condizione al
trigger esistente:

```sql
WHEN (new.tipo_venditore IS DISTINCT FROM 'Agenzia')
```

La funzione non viene chiamata per le agenzie; per "Privato", "Da verificare" e
`NULL` il comportamento resta identico.

**Sicurezze della migrazione:**
- salva la definizione originale (`pg_get_triggerdef`) e lo stato di
  abilitazione in `private.nmre_trigger_definition_backups`;
- si **interrompe senza modifiche** se il trigger non esiste, se ce n'è più di
  uno o se la forma non è quella attesa (AFTER INSERT FOR EACH ROW, senza WHEN né
  argomenti);
- è idempotente;
- conserva lo stato del trigger (attivo, disattivato, replica).

**Rollback:** ripristina esattamente la definizione salvata e il suo stato di
abilitazione; non cancella il backup.

**Test 🧪** (`supabase/tests/run_migration_tests.sh`, con uno stub della funzione
che riproduce il comportamento osservato):

| Verifica | Esito |
|---|---|
| Prima della migrazione un'agenzia genera la notifica (riproduce AQ12) | ✅ |
| Dopo: agenzia → nessuna notifica | ✅ |
| Dopo: "Da verificare", "Privato", tipo `NULL` → notifica invariata | ✅ |
| Dopo: candidato scartato → nessuna notifica (logica della funzione invariata) | ✅ |
| Backup identico alla definizione originale; un solo trigger | ✅ |
| Seconda esecuzione: nessuna modifica, backup non duplicato | ✅ |
| Rollback: definizione identica all'originale; l'agenzia notifica di nuovo | ✅ |
| Riapplicazione dopo il rollback | ✅ |
| Trigger disattivato: resta disattivato | ✅ |
| Trigger BEFORE (forma inattesa): migrazione interrotta, trigger intatto, nessun backup | ✅ |

**Limite:** il test usa uno stub della funzione, non il codice reale di
produzione. Prima dell'applicazione: AQ17 per confermare forma e nome del
trigger (la migrazione comunque si ferma se non corrispondono).

### 3.3 Migrazione del trigger dei ribassi (L24)
File: `supabase/migrations/20261126004310_guard_agency_price_drop_notifications.sql`
· rollback: `supabase/rollback/20261126004310_guard_agency_price_drop_notifications.rollback.sql`.

**Problema:** in produzione un trigger separato su `annunci_candidati_notifiche`
crea una push `price_drop` quando una riga dello storico riporta un ribasso. La
sincronizzazione registra nello storico anche le agenzie conservate.

**Soluzione:**
- La funzione del trigger **non viene riscritta**.
- Una condizione `WHEN` non può contenere sottoquery. Si crea quindi una funzione
  di sola lettura, `private.nmre_candidate_is_agency(candidate_id)`, che
  restituisce TRUE solo se il candidato collegato è "Agenzia".
- Questa condizione viene **aggiunta** a quella del trigger esistente:
  - senza condizione: `WHEN (NOT private.nmre_candidate_is_agency(new.candidate_id))`;
  - con condizione già presente: `WHEN ((<condizione originale>) AND NOT private.nmre_candidate_is_agency(new.candidate_id))`.
- La riga dello storico viene **sempre salvata**, con prezzo, prezzo precedente e
  ribasso: cambia solo l'invio della push. L'app continua a mostrare il ribasso.
- Ordine nella sincronizzazione ✅: il candidato viene inserito o aggiornato
  **prima** della riga dello storico, quindi la funzione vede già il tipo
  corretto. Un candidato in coda non viene mai declassato ad agenzia
  automaticamente, per cui un "Da verificare" continua a generare la push di
  ribasso, come previsto.

**Individuazione e sicurezze:**
- Viene scelto il trigger non interno della tabella la cui funzione scrive in
  `nmre_notifications`.
- La migrazione si ferma **senza alcuna modifica** se:
  - un trigger del genere non c'è, oppure ce n'è più di uno;
  - non è AFTER FOR EACH ROW su INSERT e/o UPDATE;
  - la definizione non è riconosciuta.
- La funzione di supporto e la tabella di backup vengono create **dopo** i
  controlli, nello stesso blocco atomico (correzione emersa dai test: nella
  prima versione la funzione di supporto restava creata anche quando la
  migrazione si fermava).
- È idempotente, conserva lo stato di abilitazione e, alla fine, verifica che la
  nuova definizione contenga la protezione.

**Rollback:** ripristina esattamente la definizione originale e lo stato del
trigger, poi rimuove la funzione di supporto se nessun altro trigger la usa. Lo
storico e il backup restano.

**Test 🧪**: due varianti del trigger dei ribassi, (a) `AFTER INSERT OR UPDATE`
con `WHEN (new.price_drop_percent IS NOT NULL)` e (b) `AFTER INSERT` senza
condizione, simulando l'ordine della sincronizzazione (prima il candidato, poi la
riga dello storico con ribasso):

| Verifica | (a) | (b) |
|---|---|---|
| Prima delle migrazioni: l'agenzia genera `new_opportunities` **e** `price_drop` (riproduce il problema) | ✅ | ✅ |
| Dopo: **agenzia → 0 `new_opportunities`, 0 `price_drop`**; storico salvato con ribasso 5% | ✅ | ✅ |
| Dopo: **privato → 1 `new_opportunities`, 1 `price_drop`** | ✅ | ✅ |
| Dopo: "Da verificare" e tipo `NULL` → notifiche invariate | ✅ | ✅ |
| Percorso UPDATE (upsert su conflitto): agenzia 0 push, privato 1 push | ✅ | — |
| Condizione originale conservata nella nuova definizione | ✅ | — |
| Backup identico all'originale; seconda esecuzione senza effetti | ✅ | ✅ |
| Rollback: definizione identica, funzione di supporto rimossa, l'agenzia torna a generare `price_drop` | ✅ | ✅ |
| Riapplicazione dopo il rollback; **nessuna riga dello storico persa** | ✅ | ✅ |
| Trigger per istruzione o assente → migrazione interrotta, **nessun oggetto creato** | ✅ | |

Totale suite migrazioni: **59 controlli** superati in locale.

---

## 4. Fase 2 · Avvisi dubbi (preparata, non applicata)

**Obiettivo:** nessun avviso immobiliare escluso dal filtro va perso. Lo si
conserva in una **sezione da verificare**, con il riferimento all'email
originale, **senza cambiare** le regole del filtro né del classificatore.

### 4.1 Funzionamento
1. Il filtro decide come oggi. Per ogni email esclusa, una **rete di sicurezza**
   cerca una prova oggettiva (`_shared/dubious.ts`, regole documentate e testate):
   - **scheda specifica** di un portale riconosciuto nel testo (anche se non è il
     link principale scelto dal filtro: caso L3), oppure
   - **mittente** di un portale riconosciuto (casi L2, L4).

   Le esclusioni nell'**oggetto** (benvenuto, password, verifica account)
   richiedono la scheda specifica: il solo mittente del portale non basta.
2. Le email con una prova vengono salvate in `nmre_gmail_avvisi_dubbi`: ID Gmail
   e intestazione **Message-ID** (riferimento all'email originale), data di
   ricezione, regola che l'ha esclusa, prova, portale, link della scheda, oggetto.
   **Nessun testo del messaggio.** L'email resta in Gmail.
3. Nell'app, sezione **"Avvisi dubbi da verificare"** con: "**Apri in Gmail**"
   (ricerca `rfc822msgid:`), "Apri annuncio", "**Crea candidato**", "**Ignora**"
   (con motivo) e "Ripristina".
4. "Crea candidato" porta lo stato a `da_promuovere`. La sincronizzazione
   successiva rilegge **quella** email e la tratta come avviso accettato: il
   candidato nasce con estrazione e classificazione normali e compare nella coda
   (se il classificatore dicesse "Agenzia", resta comunque "Da verificare").
   L'avviso diventa `promosso`. Se l'email non è più disponibile, l'avviso torna
   "da verificare" con la spiegazione.

### 4.2 Sicurezza e protezione dei dati
Migrazione `supabase/migrations_pending/20261125201000_gmail_dubious_alerts.sql`:
- RLS attiva;
- l'utente **legge** solo i propri avvisi e può **aggiornare solo** `stato`,
  `decisione_motivo`, `deciso_il` (privilegi per colonna);
- non può inserire, cancellare, segnare "promosso" né modificare un avviso già
  promosso;
- `anon` non ha accesso;
- vincolo di unicità per (utente, email);
- link accettati solo `https`.

Rollback (`supabase/rollback/20261125201000_gmail_dubious_alerts.rollback.sql`):
spegnere il flag, poi ritirare l'accesso all'app. **I dati raccolti restano.**
L'eliminazione della tabella è solo commentata, facoltativa e da approvare.

**Test 🧪:**

| Verifica | Esito |
|---|---|
| L'utente vede solo i propri avvisi | ✅ |
| Può chiedere la promozione | ✅ |
| Non può segnare "promosso" | ✅ |
| Non può modificare l'ID dell'email | ✅ |
| Non può modificare gli avvisi di altri | ✅ |
| Non può inserire avvisi | ✅ |
| Non può cancellare avvisi | ✅ |
| `anon` non ha accesso | ✅ |
| Link `javascript:` rifiutato | ✅ |
| Duplicati rifiutati | ✅ |
| Rollback: accesso ritirato, dati conservati | ✅ |
| Migrazione idempotente | ✅ |

### 4.3 Attivazione controllata
- Interruttore `NMRE_CAPTURE_DUBIOUS_ALERTS`, **spento per impostazione
  predefinita**: con il flag spento la funzione non tocca la tabella e il codice
  può essere distribuito prima della migrazione senza rischi.
- Con il flag acceso, un errore di salvataggio **blocca** la sincronizzazione: il
  cursore non avanza e l'email viene ritentata, quindi nessun riferimento va perso.
  Per questo il flag va acceso **solo dopo** la migrazione.
- La sezione dell'app si nasconde da sola se la tabella non esiste o non è
  leggibile (▶️ verificato nel browser).
- Volume atteso: al massimo le letture escluse con prova. AQ10 indica un limite
  superiore di 73 letture in 48 ore; AQ15 misura il dato reale dopo
  l'attivazione.

### 4.4 Cosa la Fase 2 NON fa
- Non cambia le regole di `propertyEmail()` né del classificatore. La futura
  revisione delle regole (L1–L4) userà come corpus proprio gli avvisi dubbi
  confermati o ignorati dal titolare.
- Non risolve L5 (più annunci per email). Gli avvisi multipli vengono salvati con
  il primo annuncio; la sezione dubbi non li moltiplica.

---

## 5. Rischi: risolti e aperti

| Rischio | Prima | Dopo Fase 1 | Dopo Fase 2 (flag attivo) | Resta aperto |
|---|---|---|---|---|
| L1–L4 Avvisi esclusi dal filtro | Persi senza traccia | **Misurati** per regola | **Conservati** come dubbi con prova, recuperabili | Email escluse **senza** prova (né scheda né mittente del portale): solo conteggio. Correzione delle regole dopo la revisione del corpus |
| L5 Più annunci per email | Solo il primo | Invariato | Invariato | **Aperto** (richiede migrazione dello storico) |
| L6 Spam e Cestino | Ignorati | Invariato | Invariato | **Aperto** |
| L7 Esclusioni senza traccia | Sì | Conteggi per regola nei log | Riferimento salvato per le email con prova | Parziale |
| L8 Scarto automatico (D1) | Sì | **Risolto** | — | — |
| L9 Agenzie non salvate | Sì | **Risolto** (recuperabili) | — | — |
| L10 Declassamento automatico | Sì | **Risolto** | — | — |
| L11 Registro per sottostringa | Sì | Effetti contenuti (agenzia recuperabile, niente declassamento) | — | **Aperto**: confronto a parola intera |
| L12 Scarto automatico in interfaccia (D2) | Sì | **Risolto** | — | — |
| L13 Aggiornamenti nascosti | Sì | **Risolto**: ribasso → riapertura; senza ribasso → contrassegno "Nuova notifica dopo lo scarto" | — | Scarti storici **senza data e senza nuove notifiche**: impossibile ricostruire a posteriori quali notifiche fossero successive (viene indicato in chiaro) |
| L14 Scarti senza motivo | Sì | **Risolto** (storico in `dati_estratti`) | — | Storico non atomico in caso di scrittura simultanea: tabella dedicata in futuro |
| L15 Nessuna vista degli scartati | Sì | **Risolto** | — | — |
| L16 Rielaborazione ripetuta | Sì | **Risolto** | — | Da confermare con AQ6 dopo la distribuzione |
| L17 Messaggi non più esistenti | Sì | Invariato | Per le promozioni: gestito | **Aperto** (rielaborazione) |
| L18 Candidati senza ID email | Sì | Invariato | Gli avvisi promossi hanno l'ID | **Aperto** |
| L21 Notifiche push per le agenzie | — (introdotto dalla conservazione) | **Risolto** con la migrazione del trigger | — | Da applicare prima della funzione |
| L24 Push di ribasso per le agenzie | — (introdotto dalla conservazione) | **Risolto** con la migrazione `20261125202000` | — | Da applicare prima della funzione |
| L22 Provenienza delle agenzie | — | **Risolto** | — | — |
| L23 Scarto nel connettore Insights | Sì (inattivo) | **Risolto** | — | — |
| L19–L20 Classificatore | Prudente, falsi agenzia possibili | Errori recuperabili | — | **Aperto**: corpus e misure |

---

## 6. Test

### 6.1 Test superati in locale (ultimo stato del branch)
| Suite | Esito |
|---|---|
| Deno esistenti (`parser_test.ts`, `history_test.ts`, `_shared/parser.test.ts`) | 18 superati |
| `retention_test.ts` (conservazione, riapertura, notifiche dopo lo scarto) | 16 superati |
| `property_filter_test.ts` (diagnostica e falsi negativi noti documentati) | 7 superati |
| `dubious_test.ts` (rete di sicurezza, mittente e portale, promozione, interruttore) | 10 superati |
| `nmre-insights-sync/provider_test.ts` | 6 superati |
| `deno check` di `nmre-gmail-scheduled` e `nmre-gmail-push` | superato |
| `tests/frontend/recovery_test.mjs` (provenienza delle agenzie, data dello scarto, notifiche dopo lo scarto, presa visione, scarti storici, agenzia riaperta per ribasso; dal 26/11 anche secondo scarto, date come timestamp, lettura parziale e paginazione oltre 1000 righe) | 43 superati |
| `supabase/tests/run_migration_tests.sh` su PostgreSQL 16 (trigger `new_opportunities`, trigger `price_drop` in due varianti, avvisi dubbi, rollback inclusi) | 59 superati |
| Sintassi JavaScript, 362 ID univoci, analisi SQL (42 `SELECT` nell'audit; migrazioni e rollback validi) | superati |
| Browser Chromium con Supabase simulato e dati sintetici: etichette di provenienza, contrassegno e avviso "Nuova notifica dopo lo scarto", presa visione, avvisi dubbi con link Gmail e richiesta di promozione, sezione nascosta senza tabella, nessun errore di pagina | superato |

### 6.2 GitHub Actions sulla Pull Request
Vedi §13 per l'esito dettagliato, con i link alle esecuzioni.

### 6.3 Test NON eseguiti (e perché)
| Test | Motivo | Come coprirlo |
|---|---|---|
| Esecuzione delle Edge Functions contro il database **reale** | Vietato modificare la produzione; nessun progetto Supabase di prova disponibile | Progetto di prova o `supabase start` con lo schema di base (P0 §7) |
| Migrazioni dei trigger con il **codice reale** delle funzioni di notifica (`new_opportunities` e `price_drop`) | Il codice non è nel repository; i test usano stub che riproducono il comportamento osservato (AQ12 e segnalazione del titolare) | Le migrazioni verificano forma e funzione prima di agire e si fermano senza modifiche se non corrispondono; prima e dopo l'applicazione: AQ17 |
| Lettura reale di Gmail e Pub/Sub | Richiede credenziali e casella reali | Osservazione in produzione dopo la distribuzione (§7) |
| Interfaccia contro Supabase reale | Nessun ambiente di prova | Verifica manuale dopo il passo 3 di §7 |
| `deno check` di `nmre-search-engine` e `nmre-insights-sync` con gli import originali, **in locale** | `esm.sh` non è raggiungibile da questo ambiente (eseguito in locale su una copia con import npm equivalenti) | Eseguito dal CI con gli import originali: superato (§13) |
| Test automatici dell'interfaccia nel CI (Playwright) | Prova eseguita solo in locale con Supabase simulato | Proposto per una fase successiva |

## 7. Distribuzione (passi 0–2 eseguiti dal titolare il 26/11/2026; dal passo 3 solo dopo approvazione)

### 7.1 Ordine esatto
| Passo | Azione | Come | Verifica | Se qualcosa non va |
|---|---|---|---|---|
| 0 | Controlli finali in sola lettura | **AQ17 e AQ17b** secondo la procedura del §14; AQ6 (base delle rielaborazioni), AQ10 (base delle esclusioni) | Tutte le condizioni del §14.4 soddisfatte | Fermarsi nei casi del §14.5 |
| 1 ✅ | **Migrazione del trigger** `20261126004257_guard_agency_candidate_notifications.sql` (applicata; nome originale del file `20261125200000_…`) | SQL Editor di Supabase, **solo questo file**. Non usare `supabase db push`: la cronologia delle migrazioni di produzione non è allineata al repository (P0 §7) e il comando potrebbe tentare di applicare altri file | Messaggio "Trigger … protetto"; `pg_get_triggerdef` contiene `WHEN ((new.tipo_venditore IS DISTINCT FROM 'Agenzia'::text))`; una riga in `private.nmre_trigger_definition_backups` | Rollback 7.2-A |
| 1-bis ✅ | **Migrazione del trigger dei ribassi** `20261126004310_guard_agency_price_drop_notifications.sql` (applicata; nome originale del file `20261125202000_…`) | SQL Editor, solo questo file | Messaggio "Trigger … protetto"; AQ17: `gia_protetto = true` su entrambe le tabelle; la definizione contiene `nmre_candidate_is_agency` e l'eventuale condizione originale | Rollback 7.2-E, poi eventualmente A |
| 2 ✅ | **Funzione `nmre-gmail-scheduled`** dal commit approvato (versione 68 attiva) | `supabase functions deploy nmre-gmail-scheduled`; `NMRE_CAPTURE_DUBIOUS_ALERTS` **non impostato**; `NMRE_KEEP_AGENCY_CANDIDATES` non impostato (conserva le agenzie) | Risposte 200 con `keptForReview`, `reopenedOnPriceDrop`, `notificationsAfterDiscard`, `propertyFilterRules`; registro senza errori per 24 ore; nessuna notifica "Nuove opportunità" per agenzie | Rollback 7.2-B |
| 3 ⏳ | **Frontend** (prossimo passo) | Merge della PR su `main` (GitHub Pages); service worker `20261126-recovery-panel-2` | Coda, contrassegni, pannello "Annunci fuori dalla coda" | Rollback 7.2-C |
| 4 | (Facoltativo) funzione `nmre-insights-sync` | `supabase functions deploy nmre-insights-sync` | Il connettore resta bloccato senza autorizzazione | Versione precedente |
| 5 | Recupero guidato degli scartati «Da verificare» (§8; 88 alla rilevazione AQ2 del 25/11), uno alla volta | Pannello dell'app | AQ13 | Ogni decisione è reversibile dal pannello |
| 6 | **Fase 2**: migrazione `supabase/migrations_pending/20261125201000_gmail_dubious_alerts.sql` (da rinumerare dopo l'ultima versione di produzione, vedi `supabase/migrations_pending/README.md`) | SQL Editor, solo questo file | Tabella con RLS attiva; Q2/Q3: solo policy di select e update per il proprietario | Rollback 7.2-D |
| 7 | Attivazione della Fase 2 | Secret `NMRE_CAPTURE_DUBIOUS_ALERTS=true` | Sezione "Avvisi dubbi" visibile; AQ15 dopo 48 ore; nessun errore di sincronizzazione | Rollback 7.2-D |

I passi 1 e 1-bis vanno applicati **entrambi** prima del passo 2. Se anche uno
solo non viene approvato, il passo 2 si distribuisce con
`NMRE_KEEP_AGENCY_CANDIDATES=false`, per non generare notifiche per le agenzie.

### 7.2 Rollback
| Codice | Cosa annullare | Procedura | Dati |
|---|---|---|---|
| A | Migrazione del trigger | Eseguire `supabase/rollback/20261126004257_guard_agency_candidate_notifications.rollback.sql`: ripristina la definizione originale salvata e lo stato di abilitazione; si ferma se il backup manca | Nessun dato toccato; il backup resta |
| B | Funzione di sincronizzazione | Dashboard → Edge Functions → `nmre-gmail-scheduled` → ridistribuire la versione precedente (o il commit precedente). In alternativa parziale: `NMRE_KEEP_AGENCY_CANDIDATES=false` | Le righe e lo storico scritti nel frattempo restano: non vanno rimossi |
| C | Frontend | Revert del commit di merge su `main` | Nessuno |
| D | Fase 2 | 1) rimuovere `NMRE_CAPTURE_DUBIOUS_ALERTS`; 2) eseguire `supabase/rollback/20261125201000_gmail_dubious_alerts.rollback.sql` (ritira l'accesso dall'app) | Gli avvisi raccolti restano; l'eliminazione della tabella è facoltativa, irreversibile e da approvare |
| E | Migrazione del trigger dei ribassi | Eseguire `supabase/rollback/20261126004310_guard_agency_price_drop_notifications.rollback.sql`: ripristina la definizione originale e lo stato, rimuove la funzione di supporto se inutilizzata | Storico notifiche intatto; il backup resta |

Ordine dei rollback del database: E prima di A, se si annullano entrambi. Tutti
i rollback del database sono coperti dai test (§3.2, §3.3, §4.2, §13).

## 8. Recupero dei "Da verificare" scartati (88 alla rilevazione AQ2 del 25/11/2026)

> Il numero 88 è il conteggio della rilevazione AQ2 del 25/11/2026, non un valore
> fisso. Il numero cambia con la sincronizzazione e con le decisioni manuali; finché
> il nuovo frontend non è distribuito, cresce anche per gli scarti automatici dei
> duplicati (§16.5). **Prima del recupero manuale va riletto:** in sola lettura con
> AQ1/AQ2 (`supabase/audit/p0_verifica_produzione_sola_lettura.sql`), oppure dal
> riepilogo del pannello «Annunci fuori dalla coda» dopo la distribuzione del
> frontend. Anche i conteggi per gruppo indicati sotto (per esempio «11») vengono
> dalla stessa rilevazione.

Nessuna riattivazione in blocco: recupero singolo, motivato, registrato e
reversibile dal pannello. Nessun URL, identificativo o dato personale nel
repository. **Prerequisito:** passi 1–3 distribuiti.

| Passo | Filtro nel pannello | Azione |
|---|---|---|
| 0 | — | (Facoltativo, **scrittura da approvare**) istantanea tecnica, §8.1 |
| 1 | "Con nuove notifiche dopo lo scarto" | Prima gli annunci che si sono **mossi** dopo lo scarto: riportare in revisione o "Ho visto" |
| 2 | "Scartati dalla sincronizzazione (probabile)" (11) | I più probabili errori dell'algoritmo |
| 3 | "Scartati con lo stesso link di uno scarto precedente" (14) | Verificare ripubblicazioni e ribassi |
| 4 | "Scartati manualmente o storici" (63) | A campione (AQ8, gruppo A) |
| 5 | "Agenzia · classificazione manuale" / "automatica storica" (16) | Solo se la revisione AQ8 (gruppo B) trova errori; precedenza alle "automatiche storiche" |
| 6 | — | AQ13 per contare le decisioni |

### 8.1 Istantanea facoltativa (NON eseguire senza approvazione)
```sql
create table private.backup_candidati_scartati_20261125 as
select id, owner_id, stato, tipo_venditore, seller_manual_override, updated_at
  from public.annunci_candidati
 where stato = 'scartato';
revoke all on table private.backup_candidati_scartati_20261125 from public, anon, authenticated;
```

---

## 9. Priorità successive

| Priorità | Intervento | Punti |
|---|---|---|
| 1 | Distribuzione Fase 1 (§7, passi 0–3) | L8–L10, L12–L16, L21, L22 |
| 2 | Recupero degli scartati «Da verificare» (conteggio da rileggere; 88 alla rilevazione AQ2) | — |
| 3 | Distribuzione Fase 2 (avvisi dubbi) | L1–L4, L7 |
| 4 | Revisione delle regole del filtro sul corpus degli avvisi dubbi (falsi positivi e negativi documentati) | L1–L4 |
| 5 | Più annunci per email (migrazione dello storico notifiche) | L5 |
| 6 | Storico delle decisioni in tabella dedicata | L14 |
| 7 | Registro venditori a parola intera; Spam; messaggi non più esistenti; coda per candidati senza email | L11, L6, L17, L18 |
| 8 | Classificatore: corpus etichettato, "Probabile privato" | L19, L20 |

---

## 10. Confronto: situazione attuale e situazione dopo le correzioni

| Aspetto | Oggi in produzione | Dopo Fase 1 | Dopo Fase 2 |
|---|---|---|---|
| Scarto automatico di un "Da verificare" | Sì (sincronizzazione e interfaccia) | **Mai** | Mai |
| Agenzie | Non salvate | Salvate, recuperabili, **senza push `new_opportunities` né `price_drop`** (storico dei ribassi conservato) | Idem |
| Provenienza della decisione "agenzia" | Non indicata | **Automatica, manuale o automatica storica** | Idem |
| Ribasso su uno scartato | Nascosto | Riapre il candidato | Idem |
| Nuova notifica senza ribasso su uno scartato | Nascosta | **"Nuova notifica dopo lo scarto"** con data, prezzo, titolo; avviso in coda; presa visione | Idem |
| Motivo, data e autore degli scarti | No | Sì (storico) | Sì |
| Vista e recupero degli scartati | No | Pannello con filtri | Idem |
| Avvisi esclusi dal filtro | Persi senza traccia (73 letture escluse in 48 ore, limite superiore) | Contati per regola | **Conservati** con link all'email, "Crea candidato" o "Ignora" |
| Regole del filtro e del classificatore | — | Invariate | Invariate |
| Cancellazione di dati | — | Nessuna | Nessuna |
| Schema del database | — | 1 migrazione (trigger), con rollback | +1 migrazione (tabella), con rollback |

---

## 11. File toccati

| File | Modifica |
|---|---|
| `supabase/functions/nmre-gmail-scheduled/index.ts` | Fase 1 e Fase 2 (notifiche dopo lo scarto, avvisi dubbi con flag, promozioni) |
| `.../_shared/retention.ts` | Regole di conservazione e notifiche dopo lo scarto |
| `.../_shared/dubious.ts` | **Nuovo**: rete di sicurezza degli avvisi dubbi |
| `.../_shared/parser.ts` | `propertyEmailDecision()`, `specificPortalListingUrl()` (nessuna regola cambiata) |
| `.../retention_test.ts`, `property_filter_test.ts`, `dubious_test.ts` | Test |
| `supabase/functions/nmre-insights-sync/index.ts` | Nessuno scarto automatico dei professionisti (L23) |
| `supabase/migrations/20261126004257_guard_agency_candidate_notifications.sql` | **Nuovo** · applicato in produzione (§16) |
| `supabase/migrations_pending/20261125201000_gmail_dubious_alerts.sql` | **Nuovo** · **non applicato**, fuori dalle migrazioni applicabili |
| `supabase/migrations/20261126004310_guard_agency_price_drop_notifications.sql` | **Nuovo** · applicato in produzione (§16) |
| `supabase/rollback/*.rollback.sql` | **Nuovi** |
| `supabase/tests/run_migration_tests.sh` | **Nuovo**: test su database usa e getta, rifiuta la produzione |
| `tests/frontend/recovery_test.mjs` | **Nuovo** |
| `index.html`, `sw.js` | Pannello di recupero, provenienza, notifiche dopo lo scarto, avvisi dubbi, versione del service worker |
| `.github/workflows/validate-app.yml` | Nuovi test e job delle migrazioni |
| `supabase/audit/p0_verifica_produzione_sola_lettura.sql` | Nota AQ10; AQ15–AQ16 |
| Documenti | Questo rapporto, piano, P0, README |

---

## 12. Revisione tecnica finale (25/11/2026)

| Requisito | Verifica | Esito |
|---|---|---|
| Nessuna opportunità scartata automaticamente | Ricerca di tutte le scritture di `stato = scartato` nel codice: restano solo azioni dell'utente con conferma e motivo (`discardCandidate`, classificazione manuale "Agenzia"). Rimossi D1 (sincronizzazione), D2 (interfaccia) e, nella revisione, lo scarto del connettore Insights (L23). Test: `retention_test.ts`, prova nel browser | ✅ |
| Agenzie conservate senza notifiche push | **Due percorsi push** protetti: `new_opportunities` (trigger su `annunci_candidati`, §3.2) e `price_drop` (trigger su `annunci_candidati_notifiche`, §3.3, aggiunto dopo la segnalazione del titolare). Test 🧪: un'agenzia non genera né l'una né l'altra; un privato le genera entrambe; storico dei ribassi conservato. Recupero e riclassificazione sono aggiornamenti dei candidati: il trigger dei candidati (solo INSERT) non scatta. **Condizione:** migrazioni 1 e 1-bis applicate prima della funzione (§7.1) | ✅ con prerequisito |
| Ribassi e nuove notifiche sugli scartati visibili | Ribasso → riapertura (anche per le agenzie: "Ribasso dopo lo scarto"); senza ribasso → "Nuova notifica dopo lo scarto" con data e dati essenziali e avviso in coda. Test Deno, frontend, browser | ✅ |
| Avvisi dubbi protetti da RLS, solo il proprietario | RLS attiva; select e update solo per `owner_id = auth.uid()`; update limitato a 3 colonne; nessun insert/delete per l'app; `anon` escluso. 12 test 🧪, anche in CI | ✅ |
| Rollback documentati e testati | §7.2; rollback del trigger e degli avvisi dubbi eseguiti nei test (anche in CI); rollback di funzione e frontend tramite versione precedente e revert | ✅ |
| Nessun problema introdotto nella sincronizzazione Gmail | Vedi sotto | ✅ con le osservazioni elencate |

**Sincronizzazione Gmail: cosa ho ricontrollato**
- **Cursore:** invariato. Tutti i nuovi errori vengono sollevati **prima** del
  salvataggio del cursore, quindi un errore fa ritentare l'esecuzione e non fa
  perdere messaggi.
- **Interruttori:**
  - `NMRE_CAPTURE_DUBIOUS_ALERTS` spento → nessun accesso alla nuova tabella;
  - `NMRE_KEEP_AGENCY_CANDIDATES=false` → comportamento precedente per le agenzie.
- **Classificazioni manuali:** mai toccate dalla sincronizzazione (test).
- **Query in più per esecuzione:**
  - lettura dei candidati legati alle email non riconosciute, a blocchi di 200;
  - una verifica dello storico notifiche, solo per i candidati scartati;
  - con la Fase 2 attiva, una verifica dei candidati esistenti per gli avvisi dubbi.

  Volume limitato.
- **Email già associate a un candidato:** non vengono duplicate tra gli avvisi
  dubbi (correzione della revisione finale).
- **Copie storiche:** marcate come elaborate, quindi non vengono più rilette a
  ogni ciclo.
- **Messaggi di errore:** restano testi fissi, senza dati personali.

**Osservazioni e rischi residui**
- Un errore nei nuovi percorsi rende **bloccante** l'intera esecuzione, come già
  accadeva per gli altri passaggi. Le prime 24 ore dopo il passo 2 vanno
  sorvegliate con il monitor e Q10/Q11; rollback B.
- L'interfaccia, ad app aperta, ogni 60 secondi carica anche gli scartati, il
  loro storico notifiche e gli avvisi dubbi. Il carico aggiuntivo è contenuto, ma
  aggrava il problema già noto del polling completo (P1.2 del piano).
- Il test della migrazione del trigger usa uno stub della funzione reale (§6.3).
- Errore di tipo preesistente in `nmre-insights-sync` (cache del token) emerso con
  il nuovo controllo CI: corretto senza cambiare il comportamento.

---

## 13. GitHub Actions sulla Pull Request #68

Pull Request Draft: [NicholasMagi/nicholas-magi-real-estate#68](https://github.com/NicholasMagi/nicholas-magi-real-estate/pull/68).
Workflow "Validate application code", eseguito su `pull_request` (commit di merge
con `main`).

| Run | Commit | Job `validate` | Job `migrations` | Note |
|---|---|---|---|---|
| [45702693682](https://github.com/NicholasMagi/nicholas-magi-real-estate/actions/runs/45702693682) | `83f467b` | ✅ | ✅ (28/28, "Tutti i test delle migrazioni superati" letto nel log) | Prima esecuzione |
| [45703041375](https://github.com/NicholasMagi/nicholas-magi-real-estate/actions/runs/45703041375) | `5725c31` | ❌ | ✅ | `deno check` esteso a `nmre-insights-sync` ha rivelato un errore di tipo **preesistente** (`index.ts:82`, token in cache `string \| null`) |
| [45703247449](https://github.com/NicholasMagi/nicholas-magi-real-estate/actions/runs/45703247449) | `368586a` | ✅ | ✅ | Errore corretto senza cambiare il comportamento |
| [45703420105](https://github.com/NicholasMagi/nicholas-magi-real-estate/actions/runs/45703420105) | `fedf754` | ✅ | ✅ | Commit con il rapporto completo (solo documentazione rispetto al precedente); entrambi i job verdi, confermato anche dalla verifica indipendente del titolare |
| [45704550649](https://github.com/NicholasMagi/nicholas-magi-real-estate/actions/runs/45704550649) | `1204d4d` | ✅ | ✅ | **Protezione delle push di ribasso** (migrazione `20261125202000`): tutti i passi di `validate` riusciti; nel job `migrations` il log di PostgreSQL mostra l'esecuzione dei nuovi test, compresi i casi negativi attesi ("Forma del trigger inattesa" per il trigger per istruzione, "Nessun trigger di notifica"), fino all'ultimo controllo di rollback degli avvisi dubbi. Suite completa: 59 controlli (verificati con l'elenco esplicito in locale) |
| [45704723104](https://github.com/NicholasMagi/nicholas-magi-real-estate/actions/runs/45704723104) | `0679ef2` | ✅ | ✅ | Commit finale della revisione (solo il rapporto A1 aggiornato rispetto a `1204d4d`): tutti i passi di `validate` e il job `migrations` riusciti; esito confermato anche dalla verifica indipendente del titolare (59 controlli delle migrazioni) |

Dettaglio del job `validate` (run 45703247449, verificato nei log; il run
45703420105 sul commit `fedf754` ha eseguito gli stessi passi, tutti riusciti):

| Passo | Esito |
|---|---|
| `deno check` di `nmre-gmail-scheduled`, `nmre-gmail-push`, `nmre-search-engine`, `nmre-insights-sync` | ✅ |
| Test Deno di parser e cronologia | 18 superati, 0 falliti |
| Test Deno di conservazione, filtro e avvisi dubbi | 33 superati, 0 falliti (16 + 7 + 10) |
| Test del pannello di recupero (Node) | 24 superati |
| Test del connettore Insights | 6 superati |
| Sintassi del JavaScript incorporato | ✅ |
| ID HTML univoci | 362 verificati |

Job `migrations`: PostgreSQL 16 usa e getta (container di servizio). Lo script
si interrompe al primo controllo fallito, quindi l'esito verde implica tutti i
controlli superati: 28 fino a `fedf754`, 59 da `1204d4d` (con i test delle push di
ribasso). Nel log di PostgreSQL compaiono gli errori **attesi** dei test
negativi: forma inattesa del trigger, RLS, permessi, vincolo `https`, duplicato,
accesso ritirato dal rollback.

Avviso non bloccante: GitHub segnala la deprecazione di Node.js 20 per
`actions/checkout@v4` e `actions/setup-node@v4`; da aggiornare in seguito,
senza effetti oggi.


---

## 14. Verifica AQ17 prima delle migrazioni (istruzioni operative)

> **26/11/2026:** le due migrazioni risultano applicate (§16). La stessa procedura
> serve ora come controllo dopo l'applicazione: atteso `gia_protetto = true` e
> `ha_condizione_when = true` su entrambi i trigger (§14.4, ultimo blocco).

**Scopo:** confermare in produzione, **in sola lettura**, che i due trigger di
notifica push hanno la forma su cui sono state costruite e testate le migrazioni
`20261125200000` (notifiche `new_opportunities`) e `20261125202000`
(notifiche `price_drop`). Le query non modificano nulla: sono `SELECT` sui
cataloghi di sistema e sono state eseguite con successo dentro una transazione
`READ ONLY`, che rifiuta qualsiasi scrittura.

### 14.1 File e query
- File: `supabase/audit/p0_verifica_produzione_sola_lettura.sql`, nel branch
  `claude/confident-knuth-yvuju7` (scheda "Files changed" della PR #68).
- Query da eseguire, **una alla volta**:
  1. **AQ17**: blocco che inizia con `-- AQ17 · Trigger di notifica push`.
  2. **AQ17b**: blocco che inizia con `-- AQ17b · Prerequisiti tecnici`.
- Le altre query del file non servono per questa verifica.

### 14.2 Come eseguirle
Ogni query va eseguita dentro una **transazione esplicitamente di sola lettura**,
aperta e chiusa nella stessa esecuzione:

```sql
BEGIN TRANSACTION READ ONLY;

-- Qui la SELECT AQ17 oppure AQ17b

ROLLBACK;
```

Non usare `SET TRANSACTION READ ONLY;` da solo. Senza un `BEGIN` o uno
`START TRANSACTION` precedente non garantisce una transazione di sola lettura.

1. Supabase Dashboard → progetto NMRE → **SQL Editor** → **New query**.
2. Nella stessa query scrivere, in quest'ordine:
   - `BEGIN TRANSACTION READ ONLY;`
   - la `select` di **AQ17**, copiata dal file fino al suo punto e virgola
     (le righe di commento `--` si possono includere);
   - `ROLLBACK;`
3. Premere **Run** una sola volta, **senza selezionare una parte del testo**:
   le tre istruzioni devono partire insieme. Se si seleziona solo la `select`,
   l'editor esegue solo quella, fuori dalla transazione di sola lettura.
4. Il risultato mostrato è quello della `select`, consultabile anche dopo il
   `ROLLBACK`. Il `ROLLBACK` chiude la transazione senza toccare nulla e non
   cancella le righe già restituite.
5. Ripetere con una **nuova query** per **AQ17b**, nella stessa cornice
   `BEGIN TRANSACTION READ ONLY;` … `ROLLBACK;`.
6. Se compare un errore, non rieseguire nulla di diverso e segnalarlo (§14.5).
   La transazione si chiude da sola alla fine dell'esecuzione.
7. Non eseguire altro. In particolare non eseguire i file di `supabase/migrations/`
   né quelli di `supabase/rollback/`.

**Verifica locale della procedura** (PostgreSQL 16, database di prova con i
trigger nello stato precedente alle migrazioni):
- ogni query è stata eseguita in un unico invio, come fa il SQL Editor, sia con
  `psql` sia con il driver Node.js `pg` (8.13.1). La sequenza dei comandi è
  `BEGIN` → `SELECT` (2 righe per AQ17, 1 per AQ17b) → `ROLLBACK`;
- le righe della `SELECT` sono state restituite e lette **dopo** il `ROLLBACK`,
  con i valori attesi del §14.3;
- controllo negativo: nella stessa cornice un `CREATE TABLE` è stato rifiutato
  (`cannot execute CREATE TABLE in a read-only transaction`) e la tabella non
  esisteva dopo l'esecuzione;
- dopo l'esecuzione la sessione non aveva transazioni aperte ed era tornata in
  modalità normale (`transaction_read_only = off`).

Non è stato possibile provare il SQL Editor di Supabase da qui. L'editor
dovrebbe mostrare l'ultimo risultato che contiene righe, cioè quello della
`select`. Se invece mostrasse solo «Success. No rows returned», non vuol dire
che manchino trigger: segnalarlo e cercheremo un altro modo di leggere il
risultato.

Cosa si può condividere: definizioni dei trigger, nomi delle funzioni e valori
true/false sono schema, non dati personali. Il codice delle funzioni
(`pg_get_functiondef`) non va condiviso.

### 14.3 Risultati attesi

**AQ17**: almeno due righe. Altre righe con `crea_notifiche = false` (per
esempio trigger di aggiornamento delle date) non sono rilevanti.

| Colonna | Riga `annunci_candidati` | Riga `annunci_candidati_notifiche` |
|---|---|---|
| `funzione` | `private.nmre_notify_candidate_insert` | il nome della funzione dei ribassi (annotarlo) |
| `definizione_trigger` | `CREATE TRIGGER … AFTER INSERT ON public.annunci_candidati FOR EACH ROW EXECUTE FUNCTION private.nmre_notify_candidate_insert()`, **senza** `WHEN` e senza argomenti tra le parentesi | `… AFTER INSERT` e/o `UPDATE … FOR EACH ROW [WHEN (…)] EXECUTE FUNCTION …`, senza `DELETE` né `TRUNCATE` |
| `abilitazione` | `O` | `O` |
| `per_riga` | true | true |
| `before` | false | false |
| `su_insert` | true | true e/o `su_update` = true |
| `su_update` | false | indifferente |
| `ha_condizione_when` | false | indifferente (se presente viene conservata) |
| `crea_notifiche` | true | true |
| `categoria_new_opportunities` | true | indifferente |
| `riguarda_price_drop` | indifferente | **true** |
| `considera_tipo_venditore` | false | false |
| `gia_protetto` | **false** | **false** |

**AQ17b**: una sola riga.

| Colonna | Valore atteso |
|---|---|
| `funzione_notifica_candidati_esiste` | true |
| `trigger_che_usano_funzione_candidati` | 1 |
| `trigger_notifica_su_storico` | 1 |
| `trigger_storico_con_delete_o_truncate` | 0 |
| `trigger_storico_per_istruzione_o_before` | 0 |
| `funzione_supporto_esiste` | **false** |
| `tabella_backup_esiste` | **false** |
| `tipo_candidate_id` | `uuid` |
| `tipo_id_candidati` | `uuid` |
| `tipo_tipo_venditore` | `text` |

Questi sono esattamente i valori ottenuti eseguendo le due query sul database
di prova con i trigger che riproducono il comportamento osservato (§3.2–3.3).

### 14.4 Condizioni per autorizzare le migrazioni
Le migrazioni 1 e 1-bis (§7.1) si possono autorizzare solo se **tutte** le
condizioni del §14.3 sono soddisfatte, cioè:
1. un solo trigger su `annunci_candidati` usa `private.nmre_notify_candidate_insert`,
   ed è AFTER INSERT FOR EACH ROW, senza WHEN, attivo (`O`), non protetto;
2. un solo trigger su `annunci_candidati_notifiche` crea notifiche: AFTER FOR EACH
   ROW, su INSERT e/o UPDATE, senza DELETE o TRUNCATE, riguarda `price_drop`,
   attivo, non protetto;
3. la funzione di supporto e la tabella di backup **non** esistono ancora;
4. i tipi delle colonne sono quelli attesi;
5. nessuna delle due funzioni considera già `tipo_venditore`.

Dopo l'applicazione, rieseguire AQ17 e AQ17b. Atteso:
- `gia_protetto = true` e `ha_condizione_when = true` su entrambe le righe;
- `funzione_supporto_esiste = true` e `tabella_backup_esiste = true`;
- nella definizione del trigger dei ribassi, l'eventuale condizione originale
  ancora presente insieme a `nmre_candidate_is_agency`.

### 14.5 Quando fermarsi (non applicare nulla e riesaminare insieme)
| Caso | Perché |
|---|---|
| Una query restituisce un errore | Lo schema non è quello atteso |
| Manca la riga di una delle due tabelle, oppure `funzione` su `annunci_candidati` non è `private.nmre_notify_candidate_insert` | Le migrazioni non troverebbero il trigger (si fermerebbero da sole, ma va capito dove nascono le push) |
| Più di una riga con `crea_notifiche = true` sulla stessa tabella, oppure `trigger_notifica_su_storico` ≠ 1 | Esiste un altro percorso di notifica non coperto |
| Il trigger dei candidati ha `su_update = true`, `ha_condizione_when = true`, argomenti nella definizione, `before = true` o `per_riga = false` | Forma diversa da quella testata: la migrazione 1 si fermerebbe |
| Il trigger dei ribassi ha `before = true`, `per_riga = false`, DELETE o TRUNCATE (`trigger_storico_con_delete_o_truncate` > 0), oppure né INSERT né UPDATE | Forma diversa da quella testata: la migrazione 1-bis si fermerebbe |
| `riguarda_price_drop = false` sul trigger dello storico, oppure `crea_notifiche = false` mentre le push di ribasso arrivano | Il trigger trovato non è quello delle push di ribasso: le notifiche nascono altrove (per esempio una funzione richiamata indirettamente) |
| `categoria_new_opportunities = false` sul trigger dei candidati | La funzione potrebbe produrre altre categorie: va riletto il codice |
| `gia_protetto = true`, `funzione_supporto_esiste = true` o `tabella_backup_esiste = true` | Una migrazione o un tentativo precedente risulta già presente: non va riapplicata senza capire lo stato |
| `abilitazione` diversa da `O` | Il trigger è disattivato o in modalità replica: va chiarito prima |
| `considera_tipo_venditore = true` | La funzione filtra già per tipo: la protezione potrebbe essere ridondante o in conflitto |
| Tipi diversi da `uuid` / `uuid` / `text` | La condizione aggiunta dalla migrazione 1-bis non sarebbe valida |


---

## 15. Correzioni del frontend dopo la revisione tecnica (26/11/2026)

Interventi limitati a `index.html`, `sw.js` (versione `20261126-recovery-panel-1`) e
`tests/frontend/recovery_test.mjs`. Nessuna modifica a Edge Functions, migrazioni,
rollback, regole di classificazione o filtro delle email.

| Punto | Correzione |
|---|---|
| M1 | Le schede del pannello e degli avvisi dubbi usano la classe dedicata `candidate-recovery-card`: impaginazione verticale su desktop e smartphone |
| M2 | «Riporta in revisione» di un'agenzia scartata imposta anche `seller_manual_override: true` e `seller_classification_version: 100` (classificazione «Da verificare»): né la funzione distribuita né quella della PR possono riclassificarla come agenzia |
| M4 | A pannello chiuso: solo la coda, un indice leggero degli scartati (id, link, tipo, data; al massimo ogni 10 minuti) e un controllo filtrato dal database degli scartati con contrassegno attivo, che mantiene l'avviso. I dati completi si leggono all'apertura del pannello (e di nuovo dopo 5 minuti se resta aperto), con soli `storico_stato` e `notifiche_dopo_scarto` al posto dell'intero `dati_estratti`. Tutti gli scartati restano raggiungibili («Mostra altri») |
| B1 | Dopo un errore `PGRST205` la tabella `nmre_gmail_avvisi_dubbi` non viene più interrogata fino al ricaricamento della pagina; la sezione resta nascosta |
| B2 | «Nuova notifica dopo lo scarto» considera l'ultima data di scarto e l'ultima presa visione, anche per il contrassegno della sincronizzazione |
| B3 | La scheda in coda di un annuncio riaperto per ribasso mostra «Riaperto dopo lo scarto» con il motivo |
| B4 | Agenzie in attesa: «Ricevuto il» (data dell'email) e motivo non presentato come scarto precedente |
| B5 | Paginazione effettiva: a chiave (`id`) per i candidati, a scostamento fino a pagina vuota per le notifiche; date confrontate come timestamp |
| B6 | «Apri annuncio» e «Apri in Gmail» con area interattiva di almeno 44 px |
| Concorrenza | `nmreUpdateCandidateWithHistory` (usata anche dalla presa visione, dallo scarto e dalla verifica del venditore) aggiorna solo se `updated_at` è invariato rispetto alla lettura; altrimenti non scrive nulla e chiede di aggiornare la lista. Tutte le scritture della sincronizzazione su stato, venditore e `dati_estratti` aggiornano `updated_at` |

Test eseguiti in locale: 43 test unitari; 37 controlli nel browser (Chromium 1366 px e
iPhone 13, Supabase simulato con limite di 1000 righe per richiesta), tra cui tabella
Fase 2 assente, recupero di un'agenzia seguito da una sincronizzazione, presa visione e
secondo scarto, scritture concorrenti e paginazione oltre 1000 notifiche e 1000 scartati;
verifica con la funzione reale `sellerFieldsForExisting`. Il pannello non è stato provato
contro il database reale.


### 15.1 Ultime correzioni prima della distribuzione (26/11/2026)
Versione del service worker: `20261126-recovery-panel-2`.

- **Caricamento del pannello senza risultati parziali.** Se fallisce anche una sola
  lettura dello storico notifiche (o degli scartati), `loadCandidateRecovery()` non
  salva nulla: resta l'ultima cache valida, il pannello mostra «Dati non aggiornati»
  con la data dell'ultimo caricamento completo e il pulsante «Riprova». Senza cache
  mostra «Annunci fuori dalla coda non caricati» e «Riprova». Un aggiornamento forzato
  a pannello chiuso non svuota più la cache: la segna soltanto da rileggere.
- **Registro venditori dopo il controllo ottimistico.** `saveCandidateSeller()` ora
  aggiorna prima il candidato e scrive in `seller_identity_registry` solo se
  l'aggiornamento è stato accettato. Un conflitto non lascia identità o
  classificazioni nel registro. Se il registro non è raggiungibile dopo un
  aggiornamento riuscito, la classificazione resta salvata e l'utente viene avvisato
  che gli identificativi non sono stati memorizzati (nessuna falsa conferma).
- Test: 55 test unitari (12 nuovi sulla verifica del venditore, con le funzioni
  reali estratte da `index.html`: conflitto, ordine delle scritture, registro non
  disponibile; 4 di questi falliscono sul codice di `5c6ea1c` e passano su quello
  nuovo); 8 controlli nel browser sul guasto dello
  storico (primo caricamento, cache valida, «Riprova», pannello chiuso); i 37
  controlli nel browser precedenti rieseguiti senza regressioni.


### 15.2 Test persistenti del caricamento del pannello (26/11/2026)
`tests/frontend/recovery_load_test.mjs`, eseguito in CI, estrae da `index.html` ed
esegue così come sono `loadCandidateRecovery()` e `renderCandidateRecovery()`, con le
funzioni e le costanti da cui dipendono, un Supabase simulato (limite di 1000 righe
per richiesta, guasti programmabili per tabella e per numero di richiesta) e un DOM
minimo. Controlli (41):
- **Errore al primo caricamento.** Nessun dato salvato, nessuna data, indice degli
  scartati non sostituito; errore e pulsante «Riprova» nel pannello; nessuna scheda.
- **Errore alla seconda pagina dello storico** (dopo 1000 notifiche lette). La cache
  precedente non viene sovrascritta (stesso oggetto, stesso contenuto), lo storico
  resta 1500 e non diventa 1000, la data dell'ultimo caricamento è invariata e viene
  indicata nell'avviso «Dati non aggiornati».
- **Errore nel secondo gruppo di candidati** (gruppi da 100, 230 scartati). Cache e
  data invariate.
- **Errore alla seconda pagina degli scartati** (1205 scartati). Cache e indice
  invariati; lo storico non viene nemmeno letto.
- **«Riprova» con il gestore collegato dal pannello.** La cache viene sostituita, la
  nuova notifica compare, la data viene aggiornata, avviso e messaggio di errore
  vengono rimossi.

Sul codice del commit `5c6ea1c`, che salvava lo storico parziale, i primi controlli
falliscono; sul codice attuale passano tutti.

---

## 16. Versioni delle migrazioni: file locali e produzione

### 16.1 Il disallineamento
| File nel repository | Versione registrata in produzione | Stato |
|---|---|---|
| `20261125200000_guard_agency_candidate_notifications.sql` | `20261126004257` | Applicata |
| `20261125201000_gmail_dubious_alerts.sql` (Fase 2) | nessuna | **Non applicata** |
| `20261125202000_guard_agency_price_drop_notifications.sql` | `20261126004310` | Applicata |

Le due migrazioni sono state applicate dal titolare con una procedura che registra in
`supabase_migrations.schema_migrations` la data di applicazione come versione, non il
prefisso del file. Il contenuto è lo stesso, ma per la CLI di Supabase i file locali
`20261125200000` e `20261125202000` risultano **non applicati** e le versioni
`20261126004257` e `20261126004310` risultano **senza file locale**. L'intestazione
dei due file («STATO: NON APPLICATA IN PRODUZIONE») è ormai superata; non è stata
modificata perché i file delle migrazioni non vanno toccati senza approvazione.

### 16.2 Rischi
1. **Fase 2 applicata per errore.** `supabase db push` considera da applicare tutti i
   file locali senza versione remota corrispondente. Con `--include-all` (o con una
   CLI che lo richiede per inserire versioni più vecchie dell'ultima remota)
   applicherebbe anche `20261125201000_gmail_dubious_alerts.sql`, che crea la tabella
   della Fase 2 **senza approvazione**.
2. **Riesecuzione delle migrazioni dei trigger.** Sono idempotenti (rilevano «già
   protetto» e terminano senza modifiche), ma verrebbero registrate una seconda volta
   con altre versioni, peggiorando la cronologia.
3. **`supabase db pull` / `db diff`** potrebbero generare nuove migrazioni di
   allineamento con contenuti duplicati.
4. **Rollback.** I rollback non dipendono dalla versione registrata: cercano il
   backup in `private.nmre_trigger_definition_backups` tramite i nomi interni
   `20261125200000_guard_agency_candidate_notifications` e
   `20261125202000_guard_agency_price_drop_notifications` (costante `v_migration` nei
   file). Questi nomi interni **non vanno cambiati**, anche se i file vengono rinominati.

### 16.3 Regole (aggiornate dopo il riallineamento del §16.6)
- Prima di qualsiasi `supabase db push`, eseguire sempre `supabase db push --dry-run`
  e fermarsi se propone un file inatteso. Restano da evitare `--include-all`,
  `db pull`, `db reset --linked` e `migration repair`.
- Ogni migrazione futura si applica solo dal SQL Editor, un file alla volta, come
  per i passi 1 e 1-bis.

### 16.4 Procedura proposta (da approvare; non eseguita)
**Passo A · Controllo in sola lettura** (SQL Editor, un'unica esecuzione):
```sql
BEGIN TRANSACTION READ ONLY;

select version, name
  from supabase_migrations.schema_migrations
 where version >= '20261125'
 order by version;

select to_regclass('public.nmre_gmail_avvisi_dubbi') as tabella_fase_2;

select migration, table_name, trigger_name, saved_at
  from private.nmre_trigger_definition_backups
 order by saved_at;

ROLLBACK;
```
Come leggere il risultato della prima query (versioni dal 25/11/2026):
- **Righe che non riguardano questo intervento.** La query restituisce anche le
  migrazioni legittime applicate prima delle protezioni: al controllo del titolare
  del 26/11/2026 sono **sei**, con versione inferiore a `20261126004257`. Non vanno
  rinominate, spostate o «corrette» con questa procedura. Se qualcuna non ha un file
  locale corrispondente, è un disallineamento preesistente (P0 §7), da trattare a
  parte.
- **Righe rilevanti.** Solo `20261126004257` e `20261126004310`. Annotare il valore
  esatto di `name`, che servirà per i nuovi nomi dei file al passo B.

Fermarsi e riesaminare insieme, senza procedere al passo B, se:
1. manca una delle due versioni `20261126004257` o `20261126004310`;
2. il `name` di una delle due non corrisponde alla migrazione di protezione attesa
   (notifiche dei candidati per la prima, ribassi per la seconda);
3. compare una riga con versione `20261125201000` o con un `name` che contiene
   `gmail_dubious_alerts`: la Fase 2 risulterebbe registrata;
4. compare una versione successiva a `20261126004310` che non si sa spiegare;
5. `tabella_fase_2` non è nulla;
6. i backup non sono esattamente due, con i nomi interni indicati al §16.2.4: senza
   backup i rollback A ed E non sarebbero possibili.

Il numero complessivo delle righe restituite **non** è una condizione di blocco.

**Passo B · Riallineamento nel repository** (commit separato, nessuna scrittura in
produzione):
1. Rinominare con `git mv`, senza cambiare il contenuto:
   - `20261125200000_guard_agency_candidate_notifications.sql` →
     `20261126004257_<name registrato>.sql`;
   - `20261125202000_guard_agency_price_drop_notifications.sql` →
     `20261126004310_<name registrato>.sql`.

   Il suffisso deve coincidere con il campo `name` letto al passo A. I file di
   rollback possono restare con il nome attuale: dipendono solo dai nomi interni.
2. Spostare `20261125201000_gmail_dubious_alerts.sql` (e il suo rollback) fuori da
   `supabase/migrations/`, per esempio in `supabase/migrations_pending/`, così che
   nessun comando della CLI possa applicarla. Quando la Fase 2 sarà approvata, le si
   assegnerà una versione successiva a `20261126004310`.
3. Aggiornare i percorsi in `supabase/tests/run_migration_tests.sh` e nei documenti;
   la CI deve restare verde.

**Passo C · Verifica senza scritture:**
- `supabase migration list`: le versioni `20261126004257` e `20261126004310`
  risultano presenti sia in «Local» sia in «Remote»; nessuna voce della Fase 2.
  Eventuali differenze preesistenti sulle migrazioni precedenti (P0 §7) restano
  visibili e non dipendono da questo intervento;
- `supabase db push --dry-run`: non deve proporre né la Fase 2 né le due migrazioni
  di protezione. Se propone qualsiasi altro file, fermarsi: non eseguire il push.

Alternativa sconsigliata: `supabase migration repair`. Scrive nella cronologia di
produzione; se usata, non deve mai includere `20261125201000`.

### 16.5 Situazione transitoria: funzione nuova e frontend vecchio
Con la versione 68 della funzione attiva, il frontend di `main` (ancora in
produzione) continua a fare due cose quando l'app è aperta, a ogni aggiornamento:

- **Riscarta i duplicati (D2).** Rimette a «scartato», senza storico, ogni candidato
  in coda con lo stesso link di un annuncio già scartato. Questo vale anche per un
  annuncio appena riaperto per ribasso dalla funzione, se ne esiste una copia
  scartata.
- **Nasconde le agenzie.** Non mostra le agenzie conservate in coda dalla funzione.

Nessun dato va perso: queste righe saranno visibili e recuperabili nel pannello
«Annunci fuori dalla coda» (gruppo «Scartato con lo stesso link di uno scarto
precedente») dopo la distribuzione del frontend. Per questo il passo 3 andrebbe
eseguito presto, dopo la revisione. AQ13 e AQ16 permettono di misurare questi casi.

### 16.6 Riallineamento eseguito nel repository (26/11/2026)
Passo B del §16.4 eseguito con `git mv`, senza modificare il contenuto dei file
(verificato con l'impronta SHA-1 prima e dopo):

| Prima | Dopo |
|---|---|
| `supabase/migrations/20261125200000_guard_agency_candidate_notifications.sql` | `supabase/migrations/20261126004257_guard_agency_candidate_notifications.sql` |
| `supabase/migrations/20261125202000_guard_agency_price_drop_notifications.sql` | `supabase/migrations/20261126004310_guard_agency_price_drop_notifications.sql` |
| `supabase/migrations/20261125201000_gmail_dubious_alerts.sql` | `supabase/migrations_pending/20261125201000_gmail_dubious_alerts.sql` |
| `supabase/rollback/20261125200000_…rollback.sql` | `supabase/rollback/20261126004257_…rollback.sql` |
| `supabase/rollback/20261125202000_…rollback.sql` | `supabase/rollback/20261126004310_…rollback.sql` |

- **Nomi interni invariati.** `20261125200000_guard_agency_candidate_notifications` e
  `20261125202000_guard_agency_price_drop_notifications` restano nelle migrazioni e nei
  rollback: i backup dei trigger in produzione restano raggiungibili.
- **Controllo in CI.** `supabase/tests/check_migration_layout.sh` fallisce se un file
  della Fase 2 torna in `supabase/migrations/`, se una migrazione applicabile tocca
  `nmre_gmail_avvisi_dubbi`, se mancano le versioni di produzione o se cambiano i nomi
  interni. La CI esegue anche l'auto-verifica: su una copia con la Fase 2 rimessa nella
  cartella, il controllo deve fallire.
- **Il nome dei file coincide con quello indicato dal titolare.** Il passo A (controllo in
  sola lettura del campo `name` in produzione) e il passo C (`supabase migration list` e
  `db push --dry-run`) restano da eseguire da parte del titolare: da qui non è stata fatta
  alcuna operazione su Supabase.

---

## 17. Correzioni dopo la revisione indipendente (26/11/2026)

Ogni correzione è coperta da test automatici in CI. Per ciascuna è stato verificato che i
test **falliscono** reintroducendo il difetto (mutazione del codice su una copia, oppure
esecuzione sul codice del commit `858316e`) e passano sul codice corretto.

### 17.1 B1 · Riapertura ripetuta degli annunci scartati
`discardedNotificationAction()` (`_shared/retention.ts`), usata da
`applyNotificationToExistingCandidate()` (`_shared/discard_flow.ts`) chiamata da `index.ts`.
Una notifica su un candidato scartato:
- **non fa nulla** se è già stata gestita: lo storico contiene già la sua email, perché
  ogni riapertura e ogni contrassegno registrano ora `source_email_id`;
- **non fa nulla** se l'email era già acquisita prima dell'ultimo scarto: è una rilettura,
  e la decisione dell'utente prevale. Lo storico notifiche, con chiave
  `owner_id + source_email_id`, è la fonte affidabile;
- **riapre** l'annuncio solo se la notifica è nuova (oppure acquisita dopo l'ultimo scarto e
  non ancora gestita, per esempio dopo un'interruzione) e porta un ribasso nuovo, cioè un
  prezzo inferiore all'ultimo già registrato;
- altrimenti **evidenzia** l'annuncio come «Nuova notifica dopo lo scarto», che resta
  scartato.

Test (`sync_protection_test.ts`):
- riapertura, nuovo scarto, tre riletture della stessa email (nessuna azione, storico
  invariato), nuova email allo stesso prezzo (solo contrassegno) e sua rilettura (nessuna
  azione), nuova email con nuovo ribasso (riapertura);
- riaperture registrate dalla versione precedente senza email nello storico;
- elaborazione interrotta dopo la registrazione della notifica.

Con la regola della v68 i due test principali falliscono.

### 17.2 B2 · Conteggio dopo la presa visione
- **Funzione.** `recordNotificationAfterDiscard()` conserva tutti i campi del contrassegno,
  compreso `visto_il`.
- **Riferimento comune.** Frontend (`nmreNotificationsAfterDiscard`) e funzione
  (`notificationReviewReference`, `pendingNotificationsAfterDiscard`) usano lo stesso
  riferimento: il più recente tra ultimo scarto, `visto_il` e ultima voce di storico
  `notifica_dopo_scarto_vista`. Quest'ultima copre i contrassegni in cui `visto_il` era
  già andato perso.
- **Test.** Tre notifiche viste e una sola nuova danno **una** notifica nuova; i
  contrassegni storici senza `visto_il` vengono gestiti.
  `frontend_coherence_test.ts` esegue la funzione del pannello estratta da `index.html` e
  quella di `retention.ts` su 8 casi e verifica che diano lo stesso risultato; sul
  frontend di `858316e` fallisce.

### 17.3 B3 · Scritture della sincronizzazione protette
Tutte le scritture di `index.ts` su `annunci_candidati` che dipendono da un valore letto
passano da `guardedCandidateUpdate()` (`_shared/guarded.ts`):
- aggiornamento dei candidati esistenti;
- voce «conservato non riconosciuto»;
- segni tecnici delle copie storiche;
- riapertura;
- contrassegno.

Il meccanismo:
- **rilettura e ricalcolo:** la funzione rilegge il candidato, ricalcola la modifica e
  scrive solo se `updated_at` è invariato;
- **tentativi limitati:** al massimo 3 tentativi;
- **conflitto persistente:** solleva `CandidateWriteConflict`, il cursore Gmail non avanza
  e l'email viene rielaborata al ciclo successivo (le operazioni sono idempotenti).

Inoltre una nuova estrazione non cancella più `notifiche_dopo_scarto` e `pagina_pubblica`
(`preserveStatusHistory`).

Test con una modifica dell'utente tra lettura e scrittura:
- classificazione manuale;
- nuovo scarto;
- recupero;
- presa visione;
- conflitto persistente (nessuna scrittura, tentativi limitati).

Senza il controllo su `updated_at`, 5 test falliscono.

### 17.4 B4 · Preparazione all'archiviazione nel frontend
«Analizza pagina» (`analyzeCandidatePage`) non scrive nel database: propone solo valori
nei campi della scheda. La scrittura a rischio era `persist` in
`prepareCandidateForArchive`. Ora:
- rilegge il candidato prima di scrivere;
- ricostruisce `dati_estratti` dal valore del database, aggiornando solo `pagina_pubblica`;
- per i campi che l'utente non ha modificato usa il valore attuale del database, non la
  copia in memoria;
- scrive solo se `updated_at` è invariato, con al massimo 3 tentativi e un messaggio di
  conflitto.

Test (`tests/frontend/archive_persist_test.mjs`, 17 controlli sulla funzione reale):
- storico e dati scritti dalla sincronizzazione conservati;
- prezzo aggiornato dalla sincronizzazione non sovrascritto dalla copia in memoria;
- conflitto risolto con la rilettura;
- conflitto persistente senza scrittura.

Sul codice di `858316e` falliscono 8 controlli.

### 17.5 Limiti noti
- **Test della funzione Gmail.** L'orchestrazione completa di `index.ts` (chiamate a Gmail,
  blocco, cursore) non ha un test end-to-end. I test esercitano le funzioni condivise
  usate da `index.ts`; le operazioni che le circondano (ricerca della notifica nota,
  calcolo del ribasso, registrazione della notifica) sono riprodotte nei test seguendo
  l'ordine del codice.
- **Ribasso già noto.** Una nuova email che ripete un ribasso già noto (stesso prezzo)
  non riapre l'annuncio: lo evidenzia come nuova notifica. È una scelta voluta, per non
  annullare uno scarto a ogni ripetizione dello stesso ribasso.
- **Scarti senza data.** Gli scarti storici senza data registrata non vengono riaperti
  dalla rilettura di email già acquisite. Restano recuperabili dal pannello e da ogni
  notifica nuova.
- **Distribuzione.** Le correzioni della funzione (B1, B2 lato funzione, B3) **non sono
  distribuite**: in produzione resta la versione 68 finché non viene approvata e
  distribuita una nuova versione.

### 17.6 Prove aggiuntive (26/11/2026)
- **Conflitto e rielaborazione senza duplicati** (`sync_protection_test.ts`). Un conflitto
  persistente durante la riapertura produce un errore recuperabile senza scrivere nulla.
  Al ciclo successivo la stessa email riapre l'annuncio **una sola volta**, e un'ulteriore
  rilettura non fa nulla: una sola voce di riapertura nello storico, nessuna notifica
  duplicata. Un'operazione che non aggiorna il record non viene conteggiata come
  eseguita (`written: false`).
- **Garanzie strutturali di `index.ts`** (`cursor_guard_test.ts`, sul sorgente reale):
  - il cursore Gmail si salva una sola volta, dopo tutte le scritture protette;
  - nessun `catch` tra il ciclo dei candidati e il salvataggio del cursore, cioè nessun
    conflitto ignorato;
  - il ramo di errore non salva il cursore;
  - le notifiche si registrano con `upsert` su `owner_id,source_email_id`.

  Verificato per mutazione: con un `try/catch` attorno alla riapertura il test fallisce.

Totali in locale e in CI: Deno 82 test (12 sulle protezioni della sincronizzazione, 8 di
coerenza, 4 strutturali); frontend 55 + 41 + 17; migrazioni e rollback 59; nessun file
della Fase 2 in `supabase/migrations/`.

## 18. Correzioni dopo l'audit di d524e4a (26/11/2026)

Priorità: conservare le opportunità e le decisioni manuali. Ogni correzione ha un test
di regressione che **fallisce sul codice di d524e4a** e passa su quello corretto
(verifica eseguita copiando i nuovi test su una copia di d524e4a).

### 18.1 Storico
- `keptForReviewPatch` registra `conservato_non_riconosciuto` **una sola volta per
  email** (`source_email_id`): le riletture successive non scrivono nulla. Su d524e4a,
  60 riletture producevano 50 voci e cancellavano lo scarto dell'utente.
- Il limite dello storico (`trimStatusHistory`, nel frontend `nmreTrimStatusHistory`)
  elimina solo le voci automatiche più vecchie: **le voci dell'utente non vengono mai
  eliminate**. Vale anche per `preserveStatusHistory` (nuova estrazione dei dati).

### 18.2 Notifiche dopo lo scarto o la presa visione
- Ogni voce del contrassegno registra `registrata_il`, l'ora in cui NMRE l'ha registrata.
- La presa visione (e lo scarto) registra in `visti` gli identificativi delle email
  viste (`nmreAcknowledgeDiscardMarker`). Una notifica è nuova se la sua email non è tra
  quelle viste, **qualunque sia la data dell'email**.
- Contrassegni precedenti senza `visti` e voci senza identificativo: vale
  `registrata_il` (o, se manca, la data dell'email), non solo la data dell'email.
- Senza contrassegno, lo storico notifiche si confronta con `created_at` (ora del
  database) invece di `notified_at`.

### 18.3 Riapertura e orologi
- `discardedNotificationAction` non confronta più date: una notifica **già registrata**
  in NMRE non riapre mai l'annuncio; solo un'email mai registrata con un nuovo ribasso
  lo riapre. Così una riapertura fatta dalla versione 68, seguita da uno scarto con il
  vecchio frontend, non viene annullata dalla rilettura della stessa email, e un
  orologio del dispositivo in ritardo non conta.
- Nella funzione la decisione sullo scartato si scrive **prima** di registrare la
  notifica: se il ciclo si interrompe in mezzo, l'email viene rielaborata e la decisione
  è idempotente (nessuna doppia riapertura).

### 18.4 Campi corretti a mano
- Quando l'utente corregge titolo, comune, prezzo, tipologia, superficie, locali, camere
  o bagni, il campo viene registrato in `dati_estratti.campi_manuali`.
- `existingCandidatePatch` non riscrive i campi elencati; gli altri si aggiornano.
  `campi_manuali` è conservato dalle nuove estrazioni.
- **Limite:** le correzioni fatte prima di questa versione non sono riconoscibili.

### 18.5 Resilienza del ciclo
- Ogni email si elabora isolata (`processRowsIsolated`): un errore, compreso un
  conflitto persistente, riguarda solo quell'email; le altre vengono salvate.
- Se anche una sola email non è salvata, `assertAllRowsSaved` interrompe il ciclo prima
  del cursore (`IncompleteSyncError`): **il cursore Gmail non avanza** e l'email viene
  rielaborata al ciclo successivo, senza duplicati.
- Un errore dell'archiviazione automatica non interrompe il ciclo (viene conteggiato):
  il candidato resta in coda.
- **Limite:** il cursore è unico. Finché un'email continua a fallire, ogni ciclo
  rielabora lo stesso intervallo (le email nuove vengono comunque salvate).

### 18.6 Test
- `regressions_test.ts` (8), `resilience_test.ts` (2), `cursor_guard_test.ts` (7, sul
  sorgente reale), `frontend_coherence_test.ts` (13 casi), più i test del frontend.
- Su d524e4a falliscono: 8/8 di `regressions_test.ts`, `resilience_test.ts` (modulo
  assente), 3 di `cursor_guard_test.ts`, 4 di `frontend_coherence_test.ts`, il test dei
  campi manuali in `archive_persist_test.mjs`, e `recovery_test.mjs`.
- Totali: Deno 94; frontend 63 + 41 + 20; migrazioni e rollback 59; controlli nel
  browser 37 + 8. Versione del service worker: `20261126-recovery-panel-4`.

Nessuna migrazione, nessun deploy, nessuna operazione su Supabase. In produzione resta
la versione 68 della funzione e il frontend precedente.

## 19. Email Subito di ricerca salvata con più annunci (26/11/2026)

Caso reale: email del 26/11/2026 alle 09:24 da `noreply@subito.it`, oggetto «Appartamenti
a Ancona e provincia ha 3 nuovi annunci per te». L'email non contiene i tre immobili:
contiene il pulsante «Vedi i nuovi annunci», che porta alla pagina dei risultati.

### 19.1 Causa
Riprodotta con la fixture dell'email (`fixtures/subito_saved_search_email.html`):
1. **Email scartata dal filtro.** `listingUrls()` dà lo stesso punteggio a tutti i link
   Subito e sceglie il primo, cioè quello del logo (homepage). Il filtro esclude quindi
   l'email come `link_principale_generico`.
2. **Nessun annuncio apribile, comunque.** Anche scegliendo il link del pulsante, la
   pagina `/annunci-marche/vendita/...` non è una scheda: `resolveListingUrl()`
   restituisce null. Ne risulterebbe un solo candidato per tre immobili, senza URL diretto
   e senza chiave dell'immobile.
3. **Venditore sbagliato.** L'etichetta «Inserzionista: Privato» descrive il filtro della
   ricerca, ma veniva letta come prova («Privato», 99%). Questo avrebbe potuto far
   archiviare automaticamente un riepilogo che non è un annuncio.

### 19.2 Logica
- **Riconoscimento** (`_shared/subito.ts`): mittente su `subito.it` e oggetto «… ha N
  nuovi annunci» o testo «Ci sono N nuovi risultati per la ricerca che hai salvato». Gli
  avvisi di un singolo annuncio seguono il percorso normale.
- **Link**: si legge dall'HTML originale dell'email (nuovo campo `bodyHtml`). Si usa il
  pulsante «Vedi i nuovi annunci», gestendo anche i redirect con l'URL annidato. Si
  tolgono i parametri di tracciamento `utm_*`, ma si conserva `kxconfid` nell’URL usato per aprire la ricerca; il token viene escluso soltanto dalla chiave stabile della ricerca, perché può variare tra email. Dopo il redirect si verifica che la ricerca finale conservi gli stessi filtri funzionali: se il portale li perde, la notifica resta da verificare e non vengono importati risultati di una ricerca diversa. Senza pulsante si usa un altro link alla ricerca;
  altrimenti `link_mancante`.
- **Pagina dei risultati**: richiesta GET normale con un timeout di 12 secondi. Pagine
  protette (CAPTCHA, verifica anti-robot, 401, 403, 429) vengono registrate come
  `pagina_bloccata` e **non vengono aggirate**. Fonti dei dati, in ordine: dati
  strutturati `__NEXT_DATA__` (cercati in tutta la struttura, così uno spostamento non li
  fa perdere), poi JSON-LD, poi i soli link alle schede.
- **Dati per annuncio**: ID, URL diretto, titolo, prezzo, località, superficie, locali,
  descrizione, immagini, data di pubblicazione (ora italiana convertita in UTC) e tipo di
  inserzionista.
- **Integrazione** (`index.ts`): le email riconosciute passano da `subitoRowsForEmails()`,
  che produce una riga per annuncio. Il salvataggio usa `saveCandidateRow()`, cioè lo
  stesso codice di prima spostato in `_shared/save_candidate.ts`, con deduplicazione,
  scritture protette, storico notifiche e regole sugli scartati invariate.

### 19.3 Come si riconoscono gli annunci nuovi
Nessuna corrispondenza viene inventata. Un annuncio è **nuovo con certezza** solo in due
casi:
- **Annunci nell'email:** l'email elenca le schede, nello stesso numero dichiarato.
- **Finestra temporale:** devono valere insieme queste condizioni:
  - la pagina ha la data di **tutti** gli annunci;
  - è nota l'email precedente della **stessa ricerca**, cioè la stessa chiave senza
    tracciamento, ordinamento e pagina;
  - la pagina mostra almeno un annuncio anteriore a quell'email, quindi la finestra è
    completa;
  - tra le due email ci sono **esattamente** gli annunci dichiarati.

Negli altri casi l'email resta in Opportunità come notifica **da verificare**, con il
motivo e l'elenco degli annunci plausibili, ognuno con il proprio link diretto. I casi
sono: prima email di una ricerca, conteggio diverso, annuncio rimosso, pagina senza date,
dati parziali, finestra incompleta.

Con l'email reale del 26/11, se NMRE non ha ancora acquisito un'email precedente della
stessa ricerca, il risultato atteso è «da verificare» con i link plausibili. Dalla email
successiva della stessa ricerca la finestra è delimitata.

### 19.4 Duplicati, sovrascritture, tracciabilità
- **Chiave per annuncio:** `dedup_key = subito:<ID>` e `listing_key` canonica. Un
  annuncio già acquisito viene ritrovato anche **per ID**, se il titolo nell'URL è
  cambiato.
- **Annunci già presenti** (in coda, archiviati o scartati): **nessun dato riscritto**
  (`preserve_existing`). Si registra solo la nuova notifica. Per gli scartati valgono le
  regole esistenti: nuova notifica evidenziata, o riapertura per un nuovo ribasso.
- **Notifiche:** una per annuncio, con identificativo `<email>#subito-<ID>` (unico per
  `owner_id`). Ogni annuncio conserva in `dati_fonte` l'email d'origine, l'oggetto, il
  mittente e la ricerca.
- **Rielaborazione:** gli identificativi `<email>#subito-<ID>` rimandano all'email
  riepilogativa, che viene riletta.
- **Riletture:** la stessa email o la stessa pagina non producono duplicati (`upsert`
  delle notifiche, chiavi uniche).
- **Venditore:** mai «Privato» per il filtro della ricerca. Per l'annuncio vale solo il
  testo dell'annuncio, mentre il riepilogo resta sempre «Da verificare».

### 19.5 Errori
| Caso | Esito |
|---|---|
| Link mancante | Notifica da verificare, nessun nuovo tentativo |
| Pagina bloccata, errore di rete o timeout, errore HTTP, pagina vuota o modificata | Notifica da verificare con il motivo, `stato: errore` (mai «completato»). Viene riletta al ciclo successivo, al massimo 6 tentativi |
| Pagina con soli link o dati parziali | Da verificare, annunci plausibili proposti, nessun annuncio certo |
| Più di 8 pagine in un ciclo | Le email in eccesso vengono rinviate senza consumare tentativi |
| Errore di database su un annuncio o durante il recupero | L'errore resta su quella email e il **cursore Gmail non avanza**. Al ciclo successivo l'email viene completata senza duplicati |

Un tentativo riuscito dopo un errore aggiorna la notifica come «completata», con l'elenco
degli annunci recuperati.

### 19.6 Frontend
- «Apri annuncio» (`nmreCandidateListingUrl`) apre l'URL diretto dell'annuncio Subito.
- La notifica da verificare mostra lo stato del recupero, il motivo, i link diretti agli
  annunci plausibili e alla pagina dei risultati (`nmreSubitoRecoveryHtml`). Mostra solo
  link `https://www.subito.it` e il testo viene sempre convertito in modo sicuro.
- Versione del service worker: `20261126-subito-saved-search-1`.

### 19.7 Test
- `subito_test.ts` (21 test): riconoscimento, link del pulsante, pagina, link diretti,
  inserimento, deduplicazione per ID, riletture, archivio, modifiche manuali, errori,
  recupero parziale, mancato completamento. Usa le funzioni di produzione su un database
  simulato con i vincoli di unicità (`fake_supabase.ts`).
- `subito_frontend_test.ts` (3 test): navigazione dalla scheda all'annuncio.
- Le fixture HTML si basano sull'email fornita e sulla struttura dei risultati Subito.
- **Verifica per mutazione:** sette difetti reintrodotti, tutti rilevati. I difetti
  sono: riconoscimento disattivato, tutti i risultati considerati nuovi, annunci
  esistenti riscritti, nessuna deduplicazione per ID, errore di rete senza notifica,
  finestra incompleta accettata, scheda che apre la ricerca.

### 19.8 Limiti
- **Pagina reale non verificata.** La rete di questo ambiente blocca `subito.it`. La
  struttura della pagina è ricostruita sulla forma nota dei dati di Subito, non scaricata.
  Il parser tollera spostamenti e strutture diverse, e una pagina non riconosciuta
  produce una notifica da verificare, mai annunci inventati. Va comunque provata con la
  funzione distribuita.
- **Accesso alla pagina.** Se Subito protegge la pagina dalle richieste automatiche della
  funzione, il recupero risulta sempre «pagina bloccata». Le notifiche restano da
  verificare, con il link alla pagina dei risultati.
- **Prima email di ogni ricerca.** Resta da verificare, per scelta: senza l'email
  precedente non si sa da quando contare.
- **Nessuna migrazione:** la chiave della ricerca è in `dati_fonte` e gli esiti in
  `dati_estratti`.
- **Notifica precedente obbligatoria.** La finestra si basa sui candidati salvati per
  quella ricerca. Se tutti gli annunci di un'email erano già noti e non è rimasta una
  riga riepilogativa, l'email successiva risulterà da verificare: degrada verso la
  verifica, senza perdite.
