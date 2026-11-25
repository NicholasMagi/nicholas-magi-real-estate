# Proposta tecnica P0 · Sicurezza, schema e affidabilità

Versione 3 · aggiornata il 25/11/2026 con le verifiche di produzione in sola
lettura eseguite dal titolare (seconda serie: permessi dell'archiviazione
automatica, analisi dei log Gmail, contatori del motore di acquisizione).

Stato: **proposta da approvare**. Nessuna modifica è stata applicata al codice
dell'applicazione, alle Edge Functions distribuite, al database di produzione,
a Storage o alle configurazioni Supabase/Google. Branch di lavoro:
`claude/confident-knuth-yvuju7` (nessun merge su `main`, nessuna pull request).

Legenda delle fonti:
- ✅ **Codice**: verificato nel repository.
- 🟢 **Produzione**: verificato dal titolare sul progetto Supabase, in sola lettura.
- 🔎 **Da verificare**: script `supabase/audit/p0_verifica_produzione_sola_lettura.sql` o Dashboard.
- ⚠️ **Ipotesi**: deduzione ragionata, non ancora confermata.

---

## 0. Esiti delle verifiche di produzione

| # | Esito | Fonte |
|---|---|---|
| V1 | Tutte le tabelle dello schema `public` hanno RLS attiva | 🟢 |
| V2 | `private.gmail_sync_lock` e `private.gmail_push_watch_state` hanno RLS disattivata; `anon` e `authenticated` non hanno USAGE sullo schema `private` né privilegi sulle tabelle | 🟢 |
| V3 | `private.gmail_oauth_tokens`, `private.gmail_oauth_states`, `private.gmail_sync_state` hanno RLS attiva e nessuna policy; inaccessibili ai ruoli client | 🟢 |
| V4 | `nmre_auto_archive_private_candidate` è SECURITY INVOKER; EXECUTE concesso ad `authenticated` **e a `service_role`**; per gli utenti verifica `owner_id = auth.uid()`; gestisce esplicitamente il caso `service_role` con `auth.uid()` nullo | 🟢 (seconda verifica) |
| V5 | `nmre-ai-assistant` è attiva in produzione alla versione 14 e verifica `NMRE_ALLOWED_USER_ID`; il codice non è nel repository | 🟢 + ✅ |
| V6 | `nmre-push-send`, `nmre-search-engine`, `nmre-candidate-enrich` verificano il token utente ma non `NMRE_ALLOWED_USER_ID` | 🟢 + ✅ |
| V7 | Il job `nmre-gmail-hourly-sync` gira **ogni minuto**; 48 ore: 2.086 esecuzioni cron, nessuna fallita, intervallo mediano ~1 minuto | 🟢 |
| V8 | 48 ore di registro Gmail: 2.207 sincronizzazioni incrementali riuscite, 16 in errore | 🟢 |
| V9 | Protezione contro le password compromesse **disattivata** | 🟢 |
| V10 | Supabase Storage: nessun bucket | 🟢 |
| V11 | Impostazione **"Allow new users to sign up": non ancora verificata** | 🔎 |
| V12 | 15 dei 16 errori Gmail sono **consecutivi**, di categoria database, con lo stesso messaggio generico, tra le 05:10 e le 07:20 UTC del 24/11; ciascuno con una risposta HTTP 500 della **versione 49** di `nmre-gmail-scheduled` | 🟢 |
| V13 | Il 25/11 le versioni 65, 66 e 67 di `nmre-gmail-scheduled` presentano solo risposte 200 e 202 nei log analizzati | 🟢 |
| V14 | Nello stesso intervallo compaiono due errori PostgreSQL SQLSTATE 42703 (colonna inesistente); la corrispondenza con i 15 eventi **non è dimostrata** | 🟢 |
| V15 | Motore di acquisizione, 48 ore: 671 annunci rilevati, 508 da verificare (59 inseriti + 449 aggiornati), **0 privati riconosciuti automaticamente, 0 archiviazioni automatiche** | 🟢 · analisi nel piano di sviluppo, modulo A.0-bis |
| V16 | AQ9 (26/11): 508 notifiche immobiliari, tutte "Da verificare"; **0 escluse come agenzia** (la stima di circa 163 non è confermata); 0 scarti automatici della sincronizzazione; AQ2: 104 scartati (63 manuali o storici, 14 stesso URL, 11 sincronizzazione probabile, 16 agenzia manuale) | 🟢 · analisi in `docs/proposte/A1-nessuna-opportunita-persa.md` |

---

## 1. Classificazione: problemi effettivi, avvisi degli advisor, punti aperti

### 1.1 Problemi effettivi (richiedono un intervento)

| ID | Problema | Gravità | Fonte | Riferimenti |
|---|---|---|---|---|
| E1 | Tre Edge Functions accessibili a qualsiasi utente autenticato, non solo al titolare. Il rischio concreto dipende da V11: con la registrazione aperta, chiunque può creare un account e usarle | **Alta se V11 = aperta**, media altrimenti | 🟢 V6 | `nmre-push-send/index.ts:22-55`, `nmre-search-engine/index.ts:76-105`, `nmre-candidate-enrich/index.ts:176-188` |
| E2 | Registrazione proposta dall'interfaccia ("Crea account") | Alta se V11 = aperta | ✅ | `index.html:614`, `index.html:4288-4303` |
| E3 | Protezione password compromesse disattivata | Media | 🟢 V9 | Dashboard → Authentication |
| E4 | Codice di `nmre-ai-assistant` (v14) assente dal repository: non è revisionabile, non è versionato, non è ripristinabile in caso di errore | Media | 🟢 V5 | §3 |
| E5 | Recupero password assente nell'app: rischio di restare chiusi fuori | Media | ✅ | `index.html:605-617`, `4231-4239` |
| E6 | Risoluzione automatica dei link di tracciamento (GET verso domini arbitrari, link d'azione inclusi) | Alta per l'obiettivo commerciale | ✅ | §5 |
| E7 | Il monitor in Impostazioni legge solo le ultime 200 sincronizzazioni: con un'esecuzione al minuto coprono circa **3 ore e 20 minuti**, quindi i contatori "ultime 24h" (esecuzioni, errori) sono **sottostimati** | Media | ✅ + 🟢 V7 | `index.html` funzione `loadGmailSyncStatus` (`.limit(200)`) |
| E8 | Documentazione e file cron del repository non corrispondono alla produzione (repository: ogni ora / ogni 10 minuti; produzione: ogni minuto) | Media | ✅ + 🟢 V7 | §4.1 |
| E9 | Contenuto delle email (testo, mittente, oggetto) conservato e mostrato, contrariamente a quanto dichiarato | Media (minimizzazione dei dati) | ✅ | §6 |
| E10 | Schema di produzione non ricostruibile dal repository | Media | ✅ | §2 |

### 1.2 Avvisi degli advisor (nessun rischio effettivo, nessuna correzione automatica)

| ID | Avviso | Perché non è un rischio effettivo | Azione proposta |
|---|---|---|---|
| W1 | `private.gmail_sync_lock`, `private.gmail_push_watch_state` senza RLS | I ruoli client non hanno USAGE su `private` né privilegi sulle tabelle (V2); l'accesso avviene solo tramite funzioni `security definer` eseguibili da `service_role` (migrazione `20261124120000`) | **Nessuna modifica ora.** Facoltativo in futuro, come difesa in profondità e per azzerare l'avviso: `enable row level security` senza policy (le funzioni `security definer` ne sono proprietarie e continuano a funzionare). Da provare prima in locale |
| W2 | Tabelle `private.*` con RLS attiva e nessuna policy | È il comportamento voluto: negare tutto ai client (V3) | Nessuna. Documentare l'intenzione nello schema di base (§2) |

### 1.3 Punti chiusi dalle verifiche

- RLS sulle tabelle `public`: attiva ovunque (V1). Resta da revisionare il **contenuto** delle policy (`owner_id = auth.uid()`), con la query Q3 che restituisce solo indicatori.
- Funzioni critiche non eseguibili da `anon` (V4 per l'archiviazione automatica; da completare con Q5b per tutte).
- Storage: nessun bucket, quindi nessuna esposizione di file oggi (V10).
- **Permessi dell'archiviazione automatica (V4): chiuso.** `service_role` può
  eseguire la funzione e il caso `auth.uid()` nullo è gestito; per gli utenti il
  proprietario è verificato. Il punto non è più un problema aperto.
  - Distinzione importante: questa è una verifica **dei permessi e del codice**.
    La verifica **end-to-end** dell'archiviazione automatica dal backend non è
    ancora avvenuta, perché nelle ultime 48 ore non c'è stato alcun privato
    riconosciuto automaticamente (V15): il ramo che chiama la funzione
    (`nmre-gmail-scheduled/index.ts:858-862`) non è stato esercitato. La prova
    end-to-end è prevista nei test (§2.3) e nell'audit di acquisizione (piano,
    A.0-bis), non come problema di sicurezza.

### 1.4 Punti ancora aperti

| ID | Punto | Come verificarlo |
|---|---|---|
| O1 | "Allow new users to sign up" | Dashboard → Authentication → Sign In / Providers |
| O2 | ~~Permessi di `nmre_auto_archive_private_candidate`~~ | **Chiuso** (V4). Resta solo la prova end-to-end, trattata come test funzionale (§2.3) |
| O3 | Contenuto delle policy RLS | Q3 |
| O4 | "Enforce JWT" per ciascuna Edge Function | Dashboard → Edge Functions → Details |
| O5 | Gmail Push attivo o no | Logs di `nmre-gmail-push` (vedi §4.2) |
| O6 | Corrispondenza tra codice distribuito e repository per le altre 8 funzioni | `supabase functions download` + confronto (§3.3) |
| O7 | Utenti esistenti e proprietari distinti | Q13, Q14 |
| O8 | 2FA su Supabase, GitHub, Google | Impostazioni dei rispettivi account |
| O9 | Causa originaria dei 15 errori del 24/11 (versione 49) e del sedicesimo errore | §4.3 |

---

## 2. Autenticazione, registrazione e autorizzazioni

### 2.1 Stato per Edge Function

| Funzione | Autenticazione | Limitata al titolare | Stato |
|---|---|---|---|
| `nmre-gmail-oauth-start` | utente (`withSupabase auth:"user"`) | sì | ✅ corretta |
| `nmre-gmail-oauth-callback` | stato OAuth monouso legato al titolare + controllo casella | sì | ✅ corretta |
| `nmre-gmail-reader` | utente | sì | ✅ dismessa (410) |
| `nmre-gmail-scheduled` | chiave segreta | n/a | ✅ corretta |
| `nmre-gmail-push` | OIDC Google | n/a | ✅ corretta |
| `nmre-insights-sync` | utente | sì | ✅ corretta |
| `nmre-ai-assistant` (v14) | utente | sì | 🟢 corretta in produzione; codice da recuperare (§3) |
| `nmre-push-send` | chiave service **o** utente | **no** | 🟢 E1 |
| `nmre-search-engine` | utente | **no** | 🟢 E1 |
| `nmre-candidate-enrich` | utente | **no** | 🟢 E1 |

### 2.2 Modifiche proposte (da approvare)

| ID | Modifica | File coinvolti | Rischio | Mitigazione |
|---|---|---|---|---|
| A1 | Rimuovere "Crea account"; testo "Accesso riservato" | `index.html:605-617`, `4288-4303` | Nessuno per l'account esistente | Gli account si creano solo dalla Dashboard |
| A2 | Verificare (O1) e, se aperta, disattivare la registrazione | Dashboard | Basso | Riattivabile con un clic |
| A3 | Modulo condiviso `requireOwner(req)` (verifica token, confronto con `NMRE_ALLOWED_USER_ID`, risposte 401/403/503 uniformi) applicato alle tre funzioni di E1 | nuovo `supabase/functions/_shared/auth.ts`; `nmre-push-send/index.ts`, `nmre-search-engine/index.ts`, `nmre-candidate-enrich/index.ts` | Medio | Test automatici; rilascio di una funzione per volta; ritorno alla versione precedente dalla Dashboard |
| A4 | `nmre-push-send`: confronto a tempo costante della chiave service | `nmre-push-send/index.ts:31` | Basso | Notifica di prova dopo il rilascio |
| A5 | `nmre-search-engine`: solo URL `https` dei portali riconosciuti | `nmre-search-engine/index.ts:153-157` | Basso | Campo facoltativo, messaggio chiaro |
| A6 | Recupero password in app (richiesta + schermata per `PASSWORD_RECOVERY`) | `index.html` (`#auth`, `onAuthStateChange` a riga 4231) | Basso | È lo strumento principale contro il blocco dell'accesso |
| A7 | **Attivare la protezione password compromesse** (E3). Non invalida la password attuale: si applica alle nuove password e ai cambi password. ⚠️ La disponibilità dipende dal piano Supabase: da verificare nella Dashboard | Dashboard → Authentication | Basso | Prima di attivarla, verificare di conoscere la password; se quella attuale risultasse compromessa, cambiarla subito con A6 |
| A8 | MFA TOTP facoltativa per il titolare | `index.html` (Impostazioni → Account) | Medio | Codici di recupero offline; fattore rimovibile dalla Dashboard |
| A9 | CSP, Leaflet con SRI, versioni fissate di supabase-js e xlsx | `index.html:1-15`, `583`, `1381`, `3892`, `6318` | Medio | Prima in sola segnalazione su anteprima |
| A10 | Rimuovere la configurazione libera del progetto Supabase | `index.html:594-603`, `2581-2607`, `4245-4270` | Basso | Ripristino nascosto in Impostazioni |
| A11 | (Fase successiva) policy RLS restrittive con elenco di utenti autorizzati | nuova migrazione | **Alto** se errata | Solo dopo A1–A6; prima in locale; script di rimozione pronto |

### 2.3 Test

- Deno: `_shared/auth_test.ts` (senza token → 401; altro utente → 403; titolare → 200; segreto mancante → 503).
- Deno: `nmre-push-send` (chiave valida/non valida, utente non titolare); `nmre-search-engine` (URL `javascript:`, `http:`, host non portale, portale valido).
- CI: `deno check` su **tutte** le funzioni, inclusa `nmre-ai-assistant`; esecuzione di `_shared/parser.test.ts`; scansione segreti.
- Playwright su anteprima: accesso, uscita, recupero password, assenza della registrazione, tutte le sezioni senza errori con la CSP.
- Produzione, dopo ogni rilascio: accesso del titolare, notifica di prova, inserimento manuale, arricchimento di un candidato, una domanda all'assistente.
- **Archiviazione automatica end-to-end** (separata dalla verifica dei permessi, già chiusa): in locale, con lo schema di base (§7), una notifica di prova con etichetta esplicita di venditore privato deve produrre, con la service role, un candidato `Privato`, la chiamata a `nmre_auto_archive_private_candidate` e una riga in `annunci` collegata; la stessa chiamata con il token di un altro utente deve essere rifiutata. In produzione si osserva il primo caso reale (contatore `auto_archived_count` > 0 e scheda presente in Archivio).

---

## 3. Recupero e versionamento di `nmre-ai-assistant`

### 3.1 Obiettivo
Portare nel repository il codice **esattamente** distribuito (v14), senza
modificarne il comportamento, e stabilire una regola di versionamento valida per
tutte le funzioni.

### 3.2 Procedura di recupero (sola lettura sulla produzione)
1. Sul computer del titolare, con la CLI Supabase collegata al progetto:
   ```bash
   supabase functions download nmre-ai-assistant
   ```
   Il codice viene scritto in `supabase/functions/nmre-ai-assistant/`. In
   alternativa si copia il sorgente dalla Dashboard → Edge Functions →
   `nmre-ai-assistant` → Code.
2. Controllo anti-segreti prima di qualsiasi commit:
   ```bash
   grep -nEi 'sk-[A-Za-z0-9_-]{20,}|sb_secret_|service_role|eyJhbGci|-----BEGIN' -r supabase/functions/nmre-ai-assistant
   ```
   Atteso: nessun valore. La chiave OpenAI deve essere letta solo con
   `Deno.env.get("OPENAI_API_KEY")`.
3. Commit sul branch di lavoro con messaggio "Import nmre-ai-assistant v14 from
   production (no behaviour change)", **senza ridistribuire** la funzione.
4. Revisione del codice: controllo del titolare, limiti di frequenza,
   oscuramento di telefoni, email e indirizzi, `store:false`, colonne lette,
   gestione degli errori, modello configurato.
5. Inclusione in `deno check` nel CI.

### 3.3 Versionamento di tutte le Edge Functions
- **Regola**: il repository è l'unica fonte. Nessuna modifica dall'editor della
  Dashboard; ogni distribuzione parte da un commit di `main`.
- **Allineamento iniziale**: scaricare tutte le 9 funzioni distribuite e
  confrontarle con il repository (`git diff --no-index`). Le differenze vengono
  riportate in un rapporto prima di decidere quale versione tenere (O6).
- **Registro delle distribuzioni**: `docs/deploy/edge-functions.md` con funzione,
  versione Supabase, commit, data e motivo (riga iniziale:
  `nmre-ai-assistant · v14 · importata dalla produzione`).
- **Identificativo di build**: costante `BUILD` nel codice di ogni funzione,
  restituita nell'intestazione `x-nmre-build`, per sapere sempre quale commit
  risponde in produzione.
- **Distribuzione automatica (fase successiva, da approvare)**: workflow GitHub
  Actions che esegue `supabase functions deploy` solo da `main`, dopo i test, con
  il token di accesso conservato nei segreti di GitHub.

### 3.4 Rischi
- Il codice scaricato potrebbe differire dalla documentazione
  `docs/nmre-ai-assistant.md` → si aggiorna la documentazione, non il codice.
- Una ridistribuzione accidentale potrebbe cambiare versione → nessuna
  distribuzione in questa fase; la prima avverrà solo con approvazione esplicita.

---

## 4. Sincronizzazione Gmail: frequenza effettiva ed errori

### 4.1 Frequenza
🟢 La produzione esegue il job **ogni minuto**. Il repository dice altro:

| Fonte | Dichiarato | Da allineare |
|---|---|---|
| `supabase/cron/gmail-hourly-sync.sql:30` | `*/10 * * * *` | sì: il file non riflette la produzione |
| `supabase/cron/README.md` | 10 minuti | sì |
| `README.md` | ogni ora al minuto 15 | sì |
| `docs/gmail-push-setup.md` | 1 minuto | corretto |
| `index.html:727` | "ogni minuto" | corretto |
| Polling interfaccia `index.html:3330` | 60 secondi (il README dice 5 minuti) | sì |

### 4.2 Lettura dei numeri delle ultime 48 ore
- **2.086** esecuzioni cron, contro **2.223** sincronizzazioni registrate
  (2.207 riuscite + 16 in errore): circa **137** sincronizzazioni in più sono state
  avviate da altri canali. ⚠️ La causa più probabile è **Gmail Push** (o
  invocazioni manuali): va confermata con i log di `nmre-gmail-push` (O5).
- "Nessuna esecuzione cron fallita" indica solo che pg_net ha accodato la
  richiesta HTTP, non che la funzione abbia risposto con successo. L'esito reale
  è in `net._http_response` (Q9) e nel registro (Q10).
- Nessuna sincronizzazione completa nelle 48 ore: il cursore della cronologia
  Gmail è sano.
- **Errori: 16 su 2.223 (0,72%)**, di cui 15 concentrati in un unico episodio
  (V12) e 1 isolato. Il cursore viene salvato solo a sincronizzazione riuscita,
  quindi gli errori **non fanno perdere messaggi**: vengono riletti al primo ciclo
  riuscito, purché il cursore resti valido per Gmail (di norma almeno una
  settimana; l'episodio è durato circa 2 ore e 10 minuti).
- Le sincronizzazioni saltate per blocco già attivo rispondono 202 e **non** sono
  registrate: non sono comprese nei 16 errori.

### 4.3 Errori Gmail: episodio del 24/11 e stato attuale

**Fatti verificati (V12–V14)**
- 15 errori consecutivi, categoria database, stesso messaggio generico,
  05:10–07:20 UTC del 24/11, ciascuno con HTTP 500 della **versione 49**.
- Il 25/11 le versioni **65, 66, 67** hanno solo risposte 200/202 nei log analizzati.
- Due errori SQLSTATE **42703** ("colonna inesistente") nello stesso intervallo,
  **senza** prova che corrispondano ai 15 eventi.

**Conclusione**: problema storico **probabilmente superato** dalle versioni
successive, ma **causa originaria non ancora accertata**. Non viene riaperto
come problema attivo; resta il punto O9 per chiudere l'analisi.

**Ipotesi da verificare ⚠️ (non conclusioni)**
- *Disallineamento tra codice distribuito e schema.* Il codice usa colonne
  introdotte da migrazioni successive (per esempio `listing_key`,
  `deduplication_version`, `data_extraction_version`,
  `explicit_price_reduction` escluso dall'inserimento con un commento esplicito a
  `index.ts:758-759`). Una versione distribuita prima della relativa migrazione
  produrrebbe proprio un errore 42703 e un messaggio generico ("… non riuscito"),
  perché la funzione sostituisce l'errore PostgreSQL con un testo fisso.
- *Frequenza del cron in quel momento.* 15 errori in circa 130 minuti
  corrispondono a un'esecuzione ogni ~10 minuti, cioè alla pianificazione
  `*/10` presente nel repository, e non a quella attuale di un minuto. Se
  confermato, la frequenza è stata portata a un minuto dopo l'episodio.
- Il messaggio generico impedisce oggi di distinguere le cause: è un limite di
  osservabilità del codice, non dei dati.

**Come chiudere O9 (sola lettura)**
1. Confrontare l'ora di distribuzione delle versioni 49 e 50+ con l'ora di
   applicazione delle migrazioni (`supabase_migrations.schema_migrations`, solo
   nomi e date) e con la cronologia dei commit di `nmre-gmail-scheduled`.
2. Leggere nei log Postgres la colonna citata dai due errori 42703 (la colonna è
   un nome di schema, non un dato personale) e verificare se compare nel codice
   della versione 49.
3. Verificare con `cron.job_run_details` la pianificazione attiva il 24/11 (Q8,
   esteso a quella data).
4. Classificare il sedicesimo errore con Q11.

**Interventi preventivi proposti (dopo approvazione)**
- Nei log della funzione, registrare **codice SQLSTATE e nome dell'operazione**
  (mai valori o testi delle email) accanto al messaggio generico, così che
  `error_message` diventi diagnostico senza esporre dati.
- Regola di rilascio: **prima la migrazione, poi la funzione**; test in CI della
  funzione contro lo schema locale (`supabase start` + schema di base, §7), che
  fallisce se il codice usa una colonna inesistente.
- Registro delle distribuzioni (§3.3) per collegare ogni versione Supabase
  (49, 65, 66, 67…) a un commit.

**Criterio di accettazione**: nessuna sequenza di 3 o più errori consecutivi e
tasso di errore sotto lo 0,5% su 7 giorni, misurati dopo il rilascio delle
modifiche di osservabilità.

### 4.4 Proposta sulla frequenza (decisione dopo Q9–Q11b e O5)
- **Se Gmail Push è attivo e affidabile**: Push come canale principale (latenza di
  pochi secondi) e cron **ogni 5 minuti** come rete di sicurezza. Invocazioni
  ridotte da ~1.440 a ~288 al giorno, senza ritardi apprezzabili.
- **Se Push non è attivo**: mantenere **1 minuto**, che è coerente con l'obiettivo
  di vedere subito i privati, ma rendere economici i cicli senza novità. Oggi ogni
  ciclo legge comunque la coda da rielaborare e, quando ci sono avvisi
  immobiliari, il registro venditori; se la cronologia non contiene messaggi
  nuovi, il ciclo deve uscire subito dopo il controllo del cursore.
- In entrambi i casi:
  - rinominare il job da `nmre-gmail-hourly-sync` a `nmre-gmail-sync` (scrittura su
    `cron.job`, **da approvare**);
  - aggiornare `supabase/cron/gmail-hourly-sync.sql` affinché descriva la
    produzione (solo file, nessuna esecuzione);
  - **monitor corretto (E7)**: riepilogo calcolato dal database (vista o RPC
    `nmre_gmail_sync_summary(p_hours)`, con aggregati e nessun testo) al posto
    delle ultime 200 righe;
  - **conservazione del registro**: circa 1.440 righe al giorno (Q12). Proposta:
    dettaglio per 30 giorni e riepilogo giornaliero oltre. La rimozione delle righe
    di dettaglio sarà una decisione separata, con backup;
  - **avviso automatico** (categoria esistente "Errori di sincronizzazione") solo
    dopo 3 errori consecutivi o con il token da ricollegare, per evitare notifiche
    inutili;
  - **ritentativi**: attesa crescente sulle chiamate Google con risposta 429/5xx
    (massimo 3 tentativi, entro il lease di 300 secondi).

### 4.5 File coinvolti
`supabase/functions/nmre-gmail-scheduled/index.ts` (uscita anticipata, ritentativi,
conteggi), `supabase/cron/gmail-hourly-sync.sql`, `supabase/cron/README.md`,
`README.md`, `index.html` (monitor e polling), nuova migrazione con vista/RPC di
riepilogo (**solo file**, applicazione da approvare).

### 4.6 Test
- Deno: ritentativi su 429/503 simulati; nessun ritentativo su 400/401/403.
- Deno: ciclo senza novità → nessuna lettura di coda o registro, nessuna scrittura.
- SQL in locale: la vista di riepilogo restituisce gli stessi conteggi di Q10 sui dati di prova.
- Produzione, 7 giorni dopo il rilascio: Q10/Q11/Q11b rispettano il criterio di accettazione.

---

## 5. Link di tracciamento: rischio e soluzione

### 5.1 Comportamento attuale ✅
`resolveListingUrl()` (`supabase/functions/nmre-gmail-scheduled/_shared/parser.ts:233-250`),
chiamata per ogni email in parallelo (`index.ts:578-580`, dentro `Promise.all`):
- considera "tracker" qualsiasi host che inizi con `click.`, `clicks.`, `track.`,
  `tracking.`, `redirect.`, `link.`, `links.`, oltre a `google.com` e `t.co`,
  **di qualunque dominio** (`parser.ts:238-240`);
- esegue fino a **20** `GET` per email con `redirect:"follow"`, seguendo la catena
  verso **qualunque** dominio e scaricando la pagina finale;
- non ha limiti di concorrenza o tetti per esecuzione.

Con la frequenza effettiva di un minuto il rischio non aumenta per messaggio,
ma i messaggi da rielaborare (versioni del parser) vengono ripresentati più
spesso finché non sono aggiornati.

### 5.2 Rischi
| Rischio | Gravità |
|---|---|
| Visita di link d'azione (disiscrizione, conferma, "elimina ricerca"): un avviso di ricerca può spegnersi e si perdono annunci senza accorgersene | **Alta** |
| Clic falsi registrati dai portali e dai mittenti | Media |
| Blocco o limitazione dell'IP da parte dei portali | Media |
| Richieste verso domini scelti dal contenuto di un'email | Media |
| Sincronizzazioni lente, possibili timeout (vedi §4.3) | Media |
| Incoerenza con `docs/property-map-and-subito.md` e `supabase/cron/README.md` | Media |

### 5.3 Soluzione
1. Prima la risoluzione **senza rete** (destinazione incorporata nei parametri, link diretti).
2. Rete solo per **host tracker in elenco esatto** (iniziale: `clicks.immobiliare.it`).
3. **Esclusione dei link d'azione** prima di ogni richiesta (URL e testo d'ancora con
   `unsubscribe|disiscriv|cancella|annulla|optout|opt-out|preferenz|impostazioni|notification|login|logout|account|verify|verifica|conferma|password|elimina|rimuovi|feedback|segnala`);
   solo i link con contesto "annuncio" sono ammessi.
4. `redirect:"manual"`, `HEAD` (ripiego `GET` annullando subito il corpo), massimo 4
   salti; ogni `Location` deve essere `https`, senza credenziali né porte, con host
   in elenco; **ci si ferma appena l'host è un portale**, senza richiederne la pagina.
5. Limiti: 2 tracker per email, concorrenza globale 3, tetto di 150 per esecuzione,
   timeout 5 s, cache nella stessa esecuzione; oltre il tetto si rielabora al ciclo successivo.
6. Interruttore `NMRE_LINK_RESOLUTION` = `off` | `embedded_only` | `allowlist`
   (predefinito proposto `allowlist`); nel riepilogo solo **conteggi** e nomi di
   dominio dei tracker sconosciuti, mai URL completi.
7. Fallback manuale: "Apri l'annuncio dall'email" dal browser del titolare.
8. `dati_estratti.link_resolution` con metodo (`embedded`, `redirect`, `none`) e numero di salti.

**File**: `_shared/parser.ts`, `nmre-gmail-scheduled/index.ts:578-600`,
`parser_test.ts` (i due test attuali sul `GET` vanno aggiornati), migrazione
facoltativa per i conteggi (solo file), documentazione.

**Test**: link di disiscrizione su tracker in elenco → nessuna richiesta (fetch
simulato che fa fallire il test se chiamato); tracker non in elenco → nessuna
richiesta; catena verso il portale → un solo `HEAD`, nessuna richiesta al
portale; `http:`/porta/credenziali/dominio non autorizzato → `null`; più di 4
salti → `null`; rispetto di tetto e concorrenza; regressione completa del parser.
Produzione: confronto per 48 ore della quota di candidati con link diretto.

---

## 6. Contenuto delle email conservato (decisione richiesta)

✅ `nmre-gmail-scheduled/index.ts:623-635` salva mittente, oggetto, anteprima e
fino a 30.000 caratteri di testo in `annunci_candidati.dati_fonte`; la
migrazione `20261125014133` li copia in `annunci`; l'interfaccia li mostra
(`index.html:4682-4693`, `4877-4881`), mentre `index.html:724`, il README e
`supabase/cron/README.md` dichiarano il contrario. Q15 misura il volume senza
mostrare testo.

Opzioni (nessuna cancellazione senza ulteriore approvazione):
1. **Conservazione limitata (consigliata)**: estratto di massimo 2.000 caratteri
   attorno all'annuncio, senza intestazioni personali, per 90 giorni in coda;
   in archivio solo i campi estratti. Si aggiornano testi e documentazione.
2. **Conservazione completa dichiarata**: comportamento attuale, documentazione corretta, scadenza.
3. **Nessuna conservazione**: soli campi estratti.

In ogni caso la coda deve caricare solo le colonne necessarie e il testo sorgente
solo all'apertura del dettaglio (`index.html:4950-4965`).

---

## 7. Schema di produzione nel repository

1. Esportazione del **solo schema** sul computer del titolare:
   ```bash
   supabase db dump --linked --schema public,private -f supabase/schema/produzione_schema.sql
   ```
   (lo schema è il comportamento predefinito; non usare `--data-only`).
2. Controllo anti-segreti obbligatorio:
   ```bash
   grep -nEi 'sb_secret_|service_role|eyJhbGci|GOCSPX-|-----BEGIN|sk-[A-Za-z0-9]{20,}|password\s*=' supabase/schema/produzione_schema.sql
   ```
3. Scansione segreti nel CI (per esempio gitleaks).
4. Migrazione di base `supabase/migrations/00000000000000_baseline.sql`, poi
   `supabase migration repair --status applied` (scrive solo nella cronologia
   migrazioni: **da approvare separatamente**).
5. Commento esplicito nello schema per W1 e W2 ("nessuna policy: accesso solo da
   funzioni `security definer`").
6. Le migrazioni future usano definizioni complete (`create or replace function`),
   non sostituzioni di testo come in `20261125014133`.

**Test**: `supabase db reset` in locale ricostruisce tutto senza errori; le query
Q1–Q7 in locale danno gli stessi indicatori della produzione.

---

## 8. Strategia per proteggere l'app senza perdere l'accesso

### 8.1 Accesso di emergenza (prima di tutto)
- La Dashboard Supabase è indipendente dall'app: da lì si riattiva la
  registrazione, si invia un link di recupero, si crea un utente, si modifica
  `NMRE_ALLOWED_USER_ID` o si torna a una versione precedente di una funzione.
  Va protetta con 2FA e codici di recupero offline (O8).
- Confermare personalmente in Dashboard che il proprio UID coincide con
  `NMRE_ALLOWED_USER_ID` (l'assistente v14 lo verifica già: se l'assistente
  risponde al titolare, il valore è corretto ⚠️).
- Verificare di conoscere la password dell'app prima di qualsiasi passo.

### 8.2 Ordine di rilascio (ogni passo è reversibile)

| Passo | Azione | Verifica | Ritorno indietro |
|---|---|---|---|
| 0 | Script v2 (Q2–Q16) e punti aperti O1–O8 | — | — |
| 1 | Import di `nmre-ai-assistant` v14 nel repository (§3), senza ridistribuzione | Revisione | — |
| 2 | Recupero password in app (A6) | Test del recupero con il proprio account | Revert |
| 3 | Rimozione "Crea account" (A1) | Accesso del titolare | Revert |
| 4 | Registrazione disattivata, se risulta aperta (A2) | Tentativo rifiutato; accesso del titolare | Riattivazione |
| 5 | Protezione password compromesse (A7) | Accesso del titolare | Disattivazione |
| 6 | `requireOwner` su `nmre-candidate-enrich`, poi `nmre-search-engine`, poi `nmre-push-send` (A3–A5) | Uso della funzione dall'app | Versione precedente |
| 7 | Gmail: monitor corretto, uscita anticipata, ritentativi, frequenza decisa (§4) | Q10/Q11 dopo 7 giorni | Pianificazione precedente |
| 8 | Link di tracciamento: `embedded_only` per 24 ore, poi `allowlist` (§5) | Conteggi | `NMRE_LINK_RESOLUTION=off` |
| 9 | CSP (A9), MFA facoltativa (A8) | Tutte le sezioni | Rimozione |
| 10 | RLS restrittive (A11) e, facoltativamente, RLS su W1 | Q1–Q3 + uso completo | Script di rimozione |

### 8.3 Se risultano altri utenti
Nessuna cancellazione: sospensione reversibile dalla Dashboard oppure
isolamento tramite RLS, da decidere insieme.

---

## 9. Storage
🟢 Nessun bucket: nessuna esposizione di file oggi. Il primo bucket nascerà con il
modulo "Documentazione immobiliare" (piano di sviluppo, B.9): **privato**, con
policy su `storage.objects` limitate al proprietario e URL firmati a scadenza
breve. Nessun bucket verrà creato senza approvazione.

---

## 10. File che verranno toccati (dopo approvazione)

| Area | File |
|---|---|
| Frontend | `index.html` (auth, recupero password, CSP, dipendenze, monitor Gmail, polling, colonne caricate, testi) |
| Funzioni | `_shared/auth.ts` (nuovo), `nmre-push-send`, `nmre-search-engine`, `nmre-candidate-enrich`, `nmre-gmail-scheduled` (+ `_shared/parser.ts`), `nmre-ai-assistant/` (import v14) |
| Test | `parser_test.ts`, `_shared/auth_test.ts`, test di validazione di `nmre-search-engine`, test dei ritentativi Gmail |
| Database (solo file) | `supabase/schema/produzione_schema.sql`, migrazione di base, vista/RPC riepilogo Gmail |
| Cron | `supabase/cron/gmail-hourly-sync.sql` (allineamento alla produzione) |
| CI | `.github/workflows/validate-app.yml` |
| Documentazione | `README.md`, `supabase/cron/README.md`, `docs/gmail-push-setup.md`, `docs/property-map-and-subito.md`, `docs/nmre-ai-assistant.md`, nuovo `docs/deploy/edge-functions.md` |
