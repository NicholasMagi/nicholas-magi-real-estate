# A.1 · Nessuna opportunità persa

Rapporto tecnico e proposta · 25/11/2026 · branch `claude/confident-knuth-yvuju7`.

> **Regola fondamentale del progetto:** meglio 100 annunci in più da verificare
> che un solo proprietario privato perso per un errore dell'algoritmo. Prima si
> protegge ogni opportunità, poi si migliora l'intelligenza del classificatore.

**Stato:** Fase 1 completata e Fase 2 preparata sul branch, con test. **Nulla è
distribuito:** nessun deploy, merge, migrazione applicata o modifica alla
produzione. Le regole del classificatore e del filtro avvisi sono **invariate**.

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

## 3. Fase 1 · Protezione (completata sul branch, non distribuita)

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

### 3.2 Migrazione del trigger delle notifiche (AQ12)
File: `supabase/migrations/20261125200000_guard_agency_candidate_notifications.sql`
· rollback: `supabase/rollback/20261125200000_guard_agency_candidate_notifications.rollback.sql`.

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
produzione. Prima dell'applicazione: AQ12 e Q6 per confermare forma e nome del
trigger (la migrazione comunque si ferma se non corrispondono).

---

## 4. Fase 2 · Avvisi dubbi (preparata, non distribuita)

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
Migrazione `supabase/migrations/20261125201000_gmail_dubious_alerts.sql`:
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
| L22 Provenienza delle agenzie | — | **Risolto** | — | — |
| L19–L20 Classificatore | Prudente, falsi agenzia possibili | Errori recuperabili | — | **Aperto**: corpus e misure |

---

## 6. Test eseguiti su questo branch

| Suite | Esito |
|---|---|
| Deno esistenti (`parser_test.ts`, `history_test.ts`, `_shared/parser.test.ts`) | 18 superati |
| `retention_test.ts` (conservazione, riapertura, **notifiche dopo lo scarto**) | 16 superati |
| `property_filter_test.ts` (diagnostica e falsi negativi noti documentati) | 7 superati |
| `dubious_test.ts` (**rete di sicurezza**, mittente/portale, promozione, interruttore) | 10 superati |
| `nmre-insights-sync/provider_test.ts` | 6 superati |
| `deno check` di `nmre-gmail-scheduled` e `nmre-gmail-push` | superato |
| `tests/frontend/recovery_test.mjs` (**provenienza delle agenzie**, data dello scarto, notifiche dopo lo scarto, presa visione, scarti storici) | 20 superati |
| `supabase/tests/run_migration_tests.sh` su PostgreSQL 16 (trigger e avvisi dubbi, rollback inclusi) | 28 superati |
| Sintassi JavaScript, 362 ID univoci, analisi SQL (42 `SELECT` nell'audit; migrazioni e rollback validi) | superati |
| Browser Chromium con Supabase simulato: etichette di provenienza, contrassegno e avviso "Nuova notifica dopo lo scarto", presa visione, sezione avvisi dubbi con link Gmail e richiesta di promozione, sezione nascosta senza tabella, nessun errore di pagina | superato |

Il CI esegue ora anche i nuovi test Deno, il test del frontend e, in un job
separato con PostgreSQL di servizio, i test delle migrazioni. Non eseguibile qui:
`deno check` di `nmre-search-engine` (`esm.sh` non raggiungibile da questo
ambiente; file non modificato).

---

## 7. Distribuzione (solo dopo approvazione)

| Passo | Azione | Verifica | Ritorno indietro |
|---|---|---|---|
| 0 | AQ11 (confermare), AQ12 e Q6 (forma del trigger), AQ6 (base) | — | — |
| 1 | **Migrazione del trigger** `20261125200000` | AQ12: trigger con condizione WHEN; inserimento di prova non necessario | Script di rollback |
| 2 | Funzione `nmre-gmail-scheduled` (Fase 1; `NMRE_CAPTURE_DUBIOUS_ALERTS` **non impostato**) | Risposta 200 con `keptForReview`, `reopenedOnPriceDrop`, `notificationsAfterDiscard`, `propertyFilterRules`; nessun errore per 24 ore | Versione precedente dalla Dashboard; `NMRE_KEEP_AGENCY_CANDIDATES=false` |
| 3 | Frontend (merge su `main` → GitHub Pages; service worker `20261125-no-lost-opportunity-2`) | Coda, contrassegni, pannello | Revert del commit |
| 4 | Recupero guidato degli 88 (§8) | AQ13 | Ogni decisione è reversibile |
| 5 | **Fase 2**: migrazione `20261125201000`, poi `NMRE_CAPTURE_DUBIOUS_ALERTS=true` | AQ15 dopo 48 ore; sezione visibile | Flag spento, poi rollback (dati conservati) |

L'ordine 1 → 2 evita notifiche push per le agenzie. Se il passo 1 non viene
approvato, il passo 2 si distribuisce con `NMRE_KEEP_AGENCY_CANDIDATES=false`.

---

## 8. Recupero degli 88 "Da verificare" scartati

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
| 2 | Recupero degli 88 | — |
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
| Agenzie | Non salvate | Salvate, recuperabili, **senza notifiche push** | Idem |
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
| `supabase/migrations/20261125200000_guard_agency_candidate_notifications.sql` | **Nuovo** (non applicato) |
| `supabase/migrations/20261125201000_gmail_dubious_alerts.sql` | **Nuovo** (non applicato) |
| `supabase/rollback/*.rollback.sql` | **Nuovi** |
| `supabase/tests/run_migration_tests.sh` | **Nuovo**: test su database usa e getta, rifiuta la produzione |
| `tests/frontend/recovery_test.mjs` | **Nuovo** |
| `index.html`, `sw.js` | Pannello di recupero, provenienza, notifiche dopo lo scarto, avvisi dubbi, versione del service worker |
| `.github/workflows/validate-app.yml` | Nuovi test e job delle migrazioni |
| `supabase/audit/p0_verifica_produzione_sola_lettura.sql` | Nota AQ10; AQ15–AQ16 |
| Documenti | Questo rapporto, piano, P0, README |
