# Proposta tecnica P0 · Sicurezza, schema e affidabilità

Stato: **proposta da approvare**. Nessuna modifica è stata applicata al codice
dell'applicazione, alle Edge Functions distribuite, al database di produzione o
alle configurazioni Supabase/Google. Branch di lavoro: `claude/confident-knuth-yvuju7`.

Legenda: ✅ verificato nel codice del repository · 🔎 da verificare in produzione
(script `supabase/audit/p0_verifica_produzione_sola_lettura.sql` o Dashboard) ·
⚠️ ipotesi.

> Nota sull'ambiente di analisi: l'host Supabase del progetto non è raggiungibile
> dall'ambiente cloud in cui è stato preparato questo documento (connessione
> rifiutata dal proxy di rete). Tutte le verifiche di produzione sono quindi
> preparate come query in sola lettura da eseguire nel SQL Editor o come
> controlli nella Dashboard. Nessuna credenziale è stata richiesta o usata.

---

## Principi vincolanti per tutti gli interventi P0

1. **Nessuna cancellazione di dati.** Le eventuali pulizie (per esempio il testo
   delle email già salvato) saranno proposte separatamente, con backup e
   approvazione esplicita.
2. **Nessuna modifica diretta alla produzione** finché ogni intervento non è
   approvato. Ordine di rilascio: repository → test → Supabase branch / progetto
   di prova (se disponibile) → produzione, una funzione alla volta.
3. **Il proprietario non deve mai restare chiuso fuori**: ogni passo ha un piano
   di ritorno e un accesso di emergenza (vedi §5).
4. **Nel repository entrano solo schema e codice**: mai dati, token, chiavi,
   password, valori di Vault o contenuti di email. Ogni file esportato dalla
   produzione passa da un controllo automatico anti-segreti prima del commit.
5. **Lavoro su branch**, mai su `main`; integrazione tramite pull request
   approvata.

---

## 1. Autenticazione, registrazione, autorizzazioni e RLS

### 1.1 Situazione verificata nel codice ✅

**Frontend**

| Elemento | File e righe | Osservazione |
|---|---|---|
| Registrazione pubblica | `index.html:614`, `index.html:4288-4303` | Il pulsante "Crea account" chiama `supabase.auth.signUp`. Chiunque raggiunga l'URL pubblico può tentare di registrarsi. |
| Accesso | `index.html:4274-4286` | Email + password; nessun limite lato client, nessuna MFA, nessun recupero password. |
| Recupero password | — | Assente. `detectSessionInUrl:true` (`index.html:2589`) accetta il link di recupero, ma non esiste una schermata per impostare la nuova password: un'email di recupero oggi non basta a rientrare. |
| Sessione | `index.html:2585-2592` | Salvata in `localStorage`; esposta a qualsiasi script caricato nella pagina (vedi CSP, §1.4). |
| Configurazione progetto | `index.html:2596-2607`, `#setup` | URL e Publishable Key sono pubblici per natura; la schermata permette però di puntare l'app a un altro progetto Supabase (non un rischio per i dati, ma una superficie inutile). |

**Edge Functions** (nessun `supabase/config.toml` nel repository: lo stato reale di
"Enforce JWT" per ciascuna funzione è 🔎)

| Funzione | Autenticazione nel codice | Limitata a `NMRE_ALLOWED_USER_ID` | Valutazione |
|---|---|---|---|
| `nmre-gmail-oauth-start` | `withSupabase({auth:"user"})` | ✅ sì | Corretta |
| `nmre-gmail-oauth-callback` | `auth:"none"` + stato monouso + controllo casella | ✅ (lo stato è legato all'utente autorizzato) | Corretta |
| `nmre-gmail-reader` | `auth:"user"` | ✅ sì | Dismessa (410) |
| `nmre-gmail-scheduled` | `auth:"secret"` | n/a (server-to-server) | Corretta |
| `nmre-gmail-push` | `auth:"none"` + verifica OIDC Google | n/a | Corretta |
| `nmre-insights-sync` | JWT utente via `getUser()` | ✅ sì (`index.ts:127-134`) | Corretta |
| `nmre-push-send` | chiave service **oppure** qualunque JWT utente | ❌ no | Qualsiasi utente registrato può generare notifiche di prova per sé; il confronto della chiave usa `===` (`index.ts:31`). |
| `nmre-search-engine` | JWT utente via `getUser()` | ❌ no | Qualsiasi utente registrato può inserire annunci (isolati dalla RLS); l'URL non è validato come `https` (`index.ts:153-157`). |
| `nmre-candidate-enrich` | JWT utente via `getUser()` | ❌ no | Qualsiasi utente registrato può far scaricare al server pagine dei portali (consumo di risorse, possibile blocco dell'IP da parte dei portali). |
| `nmre-ai-assistant` | **non presente nel repository** | 🔎 (la documentazione dichiara di sì) | Va esportata e verificata. |

**Database**: le migrazioni del repository mostrano RLS corrette solo per
`nmre_sales_goals`, `nmre_property_contacts` e le tabelle `private.*`. Per le
tabelle principali (`annunci`, `annunci_candidati`, `annunci_interazioni`,
`annunci_candidati_notifiche`, `nmre_contacts`, `nmre_properties`,
`nmre_appointments`, `nmre_contact_interactions`, `nmre_notifications`,
`nmre_notification_preferences`, `nmre_push_subscriptions`,
`seller_identity_registry`, `nmre_gmail_sync_runs`, `nmre_omi_quotazioni`,
`nmre_compravendite_atti`) le policy non sono nel repository → 🔎.
Punto da chiarire con priorità: `nmre_auto_archive_private_candidate(uuid)` è
chiamata sia dal frontend con il JWT utente (`index.html:5276`) sia dal backend
con la service role (`nmre-gmail-scheduled/index.ts:860`). Se è
`security definer`, **deve** verificare internamente che il candidato
appartenga a `auth.uid()` quando chiamata da un utente (Q6c dello script).

### 1.2 Verifiche di produzione da eseguire 🔎

Script: `supabase/audit/p0_verifica_produzione_sola_lettura.sql`.

| Verifica | Query / luogo | Esito atteso |
|---|---|---|
| Tabelle `public` senza RLS | Q2 | Nessuna riga |
| Policy di ogni tabella | Q3 | Ogni tabella ha select/insert/update/delete limitati a `auth.uid() = owner_id`; `nmre_gmail_sync_runs` e `annunci_candidati_notifiche` solo lettura per l'utente |
| Privilegi a `anon` | Q5 | Nessun privilegio di scrittura a `anon` sulle tabelle applicative |
| RPC `security definer` | Q6, Q6b | Nessuna eseguibile da `anon`; tutte con `search_path` fissato |
| Definizione RPC critiche | Q6c | `nmre_auto_archive_private_candidate` controlla il proprietario; le RPC dei token sono eseguibili solo da `service_role` |
| Utenti esistenti | Q12, Q13 | 1 utente, 1 proprietario per tabella |
| Registrazioni | Dashboard → Authentication → Sign In / Providers → "Allow new users to sign up" | Da disattivare (§5) |
| Conferma email, protezione password compromesse, lunghezza minima | Dashboard → Authentication | Conferma email attiva; protezione password compromesse attiva |
| Enforce JWT per funzione | Dashboard → Edge Functions → ogni funzione → Details | Attivo per tutte tranne `nmre-gmail-oauth-callback`, `nmre-gmail-push`, `nmre-gmail-scheduled` (che usano altri meccanismi) |
| Nomi dei segreti (non i valori) | Dashboard → Edge Functions → Secrets | Presenti: `NMRE_ALLOWED_USER_ID`, `GOOGLE_CLIENT_ID/SECRET`, `INTEGRATION_TOKEN_ENCRYPTION_KEY`, VAPID, eventuali Pub/Sub e `OPENAI_API_KEY` |
| Schemi esposti dall'API | Dashboard → Project Settings → Data API | Solo `public` (e `graphql_public`); **non** `private` |
| 2FA sugli account di amministrazione | Account Supabase, GitHub, Google | Attiva su tutti e tre |

### 1.3 Modifiche proposte (da approvare)

| ID | Modifica | File coinvolti | Rischio | Mitigazione |
|---|---|---|---|---|
| A1 | Rimuovere il pulsante "Crea account" e il relativo handler; testo "Accesso riservato al titolare" | `index.html:605-617`, `4288-4303` | Nessuno per l'account esistente | Gli account si creano solo dalla Dashboard |
| A2 | Disattivare le registrazioni in Supabase Auth | Dashboard (nessun file) | Basso: non tocca gli utenti esistenti | Si riattiva con un clic; il titolare può sempre creare/invitare utenti dalla Dashboard |
| A3 | Modulo condiviso `_shared/auth.ts` con `requireOwner(req)`: verifica JWT con `getUser()`, confronta con `NMRE_ALLOWED_USER_ID`, risponde 401/403 uniformi | nuovo `supabase/functions/_shared/auth.ts`; `nmre-push-send`, `nmre-search-engine`, `nmre-candidate-enrich` (e `nmre-ai-assistant` dopo l'esportazione) | Medio: un errore blocca la funzione per il titolare | Test automatici con JWT simulati; distribuzione una funzione per volta; ritorno alla versione precedente dalla Dashboard |
| A4 | `nmre-push-send`: confronto a tempo costante della chiave service; percorso utente limitato al titolare | `supabase/functions/nmre-push-send/index.ts:22-52` | Basso | Test della notifica di prova dopo il rilascio |
| A5 | `nmre-search-engine`: accettare solo URL `https` dei portali riconosciuti (riuso di `canonicalListingKey`) | `supabase/functions/nmre-search-engine/index.ts:153-157` | Basso: un URL non-portale verrebbe rifiutato | Il campo resta facoltativo; messaggio chiaro all'utente |
| A6 | Recupero password in app: "Password dimenticata" + schermata per l'evento `PASSWORD_RECOVERY` | `index.html` (sezione `#auth` e handler `onAuthStateChange`, `index.html:4231-4239`) | Basso | È il principale strumento anti-blocco (§5) |
| A7 | MFA TOTP facoltativa per l'account del titolare (Supabase Auth MFA), attivata solo dopo A6 | `index.html` (Impostazioni → Account) | Medio: perdere il dispositivo TOTP | Codici di recupero conservati offline; possibilità di rimuovere il fattore dalla Dashboard |
| A8 | Content-Security-Policy via `<meta>`, Leaflet con SRI, versioni fissate di supabase-js e xlsx | `index.html:1-15`, `583`, `1381`, `3892`, `6318` | Medio: una CSP troppo stretta rompe mappa/OMI/Nominatim | Prima in modalità solo-segnalazione su un'anteprima; elenco esplicito dei domini usati |
| A9 | Rimuovere la schermata di configurazione libera del progetto Supabase (URL/chiave fissi nel codice) mantenendo un ripristino nascosto in Impostazioni | `index.html:594-603`, `2581-2607`, `4245-4270` | Basso | Il valore predefinito è già quello di produzione |
| A10 | (Difesa in profondità, fase successiva) policy RLS **restrittive** che, oltre a `owner_id = auth.uid()`, richiedono che l'utente sia nella tabella `private.nmre_allowed_users` | nuova migrazione | **Alto** se sbagliata: blocca l'app | Solo dopo A1–A6; prima su progetto di prova; script di rimozione pronto; si applica una tabella alla volta |

### 1.4 Test necessari

- Deno: test per `_shared/auth.ts` (senza token → 401; token di altro utente → 403; titolare → 200; segreto mancante → 503).
- Deno: test `nmre-push-send` (chiave service valida/non valida; utente non titolare).
- Deno: test `nmre-search-engine` per URL `javascript:`, `http:`, host non portale, URL portale valido.
- Workflow CI: estendere `deno check` a **tutte** le funzioni e includere `_shared/parser.test.ts`.
- Playwright (manuale su anteprima, poi automatico): accesso, uscita, recupero password, assenza del pulsante di registrazione, apertura di ogni sezione senza errori in console con la CSP attiva.
- Produzione, dopo ogni rilascio: accesso del titolare, notifica di prova, ricollegamento Gmail, inserimento manuale, arricchimento di un candidato.

---

## 2. Schema effettivo di produzione nel repository

### 2.1 Problema ✅
Il repository contiene solo migrazioni incrementali: non è possibile ricostruire
il database né revisionare le policy. La migrazione
`20261125014133_archive_candidate_full_extraction_data.sql` riscrive funzioni
con sostituzioni di testo su `pg_get_functiondef`, quindi non è riapplicabile su
un database nuovo.

### 2.2 Procedura proposta (eseguita dal titolare sul proprio computer, oppure da me se verrà fornito un accesso adeguato)

1. Esportare **solo lo schema**, senza dati:
   ```bash
   supabase db dump --linked --schema public,private -f supabase/schema/produzione_schema.sql
   ```
   (`supabase db dump` esporta lo schema per impostazione predefinita; i dati
   richiederebbero l'opzione `--data-only`, che **non** va usata.)
2. Esportare le Edge Functions distribuite che mancano (`nmre-ai-assistant`) con
   `supabase functions download nmre-ai-assistant`.
3. Controllo anti-segreti obbligatorio prima del commit:
   ```bash
   grep -nEi 'sb_secret_|service_role|eyJhbGci|GOCSPX-|-----BEGIN|sk-[A-Za-z0-9]{20,}|password\s*=' supabase/schema/produzione_schema.sql supabase/functions -r
   ```
   Se compare qualcosa, il file non si committa: si rimuove il valore e si ruota
   la chiave.
4. Aggiungere al CI un passaggio di scansione segreti (per esempio `gitleaks`) su
   ogni push.
5. Trasformare l'esportazione in **migrazione di base** (`supabase/migrations/00000000000000_baseline.sql`)
   e marcarla come già applicata in produzione con
   `supabase migration repair --status applied <versione>` (operazione che scrive
   solo nella tabella della cronologia migrazioni: **da approvare separatamente**).
6. Sostituire le migrazioni a "sostituzione di testo" con definizioni complete
   (`create or replace function ...`) nelle migrazioni future.

### 2.3 Rischi e test
- Rischio: includere per errore dati o segreti → mitigato da `--schema-only`
  implicito, controllo `grep`, gitleaks, revisione della pull request.
- Rischio: divergenza tra schema esportato e migrazioni esistenti → si confronta
  con `supabase db diff` su un database locale (`supabase start`) prima della
  pull request.
- Test: `supabase db reset` in locale deve ricostruire l'intero schema senza
  errori; le query Q1–Q7 eseguite in locale devono dare lo stesso risultato
  della produzione.

---

## 3. Frequenza reale della sincronizzazione Gmail

### 3.1 Cosa dice oggi il repository ✅

| Fonte | Frequenza dichiarata |
|---|---|
| `README.md` | ogni ora al minuto 15 |
| `supabase/cron/gmail-hourly-sync.sql:30` | ogni 10 minuti (`*/10 * * * *`) |
| `supabase/cron/README.md` | ogni 10 minuti |
| `index.html:727` | "ogni minuto" |
| `docs/gmail-push-setup.md` | "one-minute fallback" |
| Polling del frontend (`index.html:3330`) | 60 secondi (il README dice 5 minuti) |

### 3.2 Come stabilire la frequenza reale 🔎
- **Q8**: pianificazione effettiva dei job `cron.job`.
- **Q9**: intervallo mediano reale tra le esecuzioni del cron nelle ultime 48 ore.
- **Q10**: esiti HTTP di `pg_net` (in particolare `timed_out`, dato il timeout di 30 s).
- **Q11**: intervallo reale tra le sincronizzazioni registrate in
  `nmre_gmail_sync_runs`, che comprende anche quelle avviate da Gmail Push.
- Dashboard → Edge Functions → `nmre-gmail-push` → Logs: se ci sono invocazioni,
  Gmail Push è attivo e la latenza effettiva è di pochi secondi.

### 3.3 Proposta (dopo la verifica)
- Obiettivo commerciale: vedere gli annunci privati il prima possibile. Proposta:
  **Gmail Push come canale principale + cron ogni 10 minuti come rete di
  sicurezza**; se Push non è configurato, cron ogni 5 minuti.
- Rinominare il job in `nmre-gmail-sync` (con `cron.unschedule` +
  `cron.schedule`: scrittura sul database, **da approvare**).
- Portare `timeout_milliseconds` a un valore coerente con la durata misurata (Q11).
- Allineare `README.md`, `supabase/cron/README.md`, `docs/gmail-push-setup.md`,
  `index.html:727` e la riga del polling; mostrare in Impostazioni la frequenza
  **misurata** (dall'ultimo intervallo in `nmre_gmail_sync_runs`) invece di un
  testo fisso.

---

## 4. Rischio dei reindirizzamenti automatici dei link di tracciamento

### 4.1 Comportamento attuale ✅
`resolveListingUrl()` (`supabase/functions/nmre-gmail-scheduled/_shared/parser.ts:233-250`),
chiamata per ogni email in parallelo (`index.ts:578-580`, dentro `Promise.all`):

1. considera "tracker" qualsiasi host che inizi con `click.`, `clicks.`,
   `track.`, `tracking.`, `redirect.`, `link.`, `links.`, oltre a `google.com` e
   `t.co`, **di qualunque dominio** (`parser.ts:238-240`);
2. per fino a **20 link per email** esegue `fetch(..., {method:"GET", redirect:"follow"})`;
3. segue **tutta** la catena di reindirizzamenti verso **qualunque** dominio, scarica la
   pagina finale (incluso il portale) e ne guarda solo l'URL;
4. non c'è un limite di concorrenza globale né un tetto per esecuzione.

### 4.2 Rischi
| Rischio | Gravità | Note |
|---|---|---|
| Visita automatica di link d'azione (disiscrizione, conferma, "non mi interessa", "elimina ricerca") | **Alta** per l'obiettivo commerciale | Un GET su un link di disiscrizione può spegnere un avviso di ricerca: si perderebbero annunci senza accorgersene. |
| Segnali di "clic" falsi al portale e al mittente | Media | Il portale registra interazioni non fatte dal titolare; profilazione dell'account. |
| Blocco o limitazione dell'IP Supabase da parte dei portali | Media | Molte richieste concorrenti alle pagine di dettaglio. |
| Richieste verso domini arbitrari scelti dal contenuto di un'email | Media | Chiunque può inviare un'email che fa interrogare al server un dominio `click.qualcosa`; esfiltrazione minima (l'ID di un link), possibile uso come amplificatore. |
| Sincronizzazioni lente o in timeout | Media | Fino a 20 × 8 s per email, senza limiti globali. |
| Incoerenza con la documentazione | Media | `docs/property-map-and-subito.md` e `supabase/cron/README.md` dichiarano che i link non vengono visitati. |

### 4.3 Soluzione proposta
Obiettivo: **non perdere** il link diretto all'annuncio (utile alla
deduplicazione e al lavoro commerciale) eliminando i rischi.

1. **Prima la risoluzione senza rete** (già presente): destinazione incorporata nei
   parametri (`url`, `u`, `q`, `target`…) e link diretti ai portali.
2. **Risoluzione di rete solo per tracker in elenco esplicito** di host esatti
   (iniziale: `clicks.immobiliare.it`; altri aggiunti solo dopo averli osservati,
   vedi punto 6). Niente più regole del tipo "qualsiasi host che inizia per click.".
3. **Filtro sui link d'azione prima di qualsiasi richiesta**: si scartano URL e
   testo d'ancora che contengono `unsubscribe|disiscriv|cancella|annulla|optout|opt-out|preferenz|impostazioni|notification|alert/(?:delete|stop)|login|logout|account|verify|verifica|conferma|password|elimina|rimuovi|feedback|segnala`.
   Solo i link il cui contesto indica un annuncio ("vedi annuncio", "dettagli",
   foto/titolo) sono ammessi alla risoluzione.
4. **Richiesta minima e controllata**: `redirect:"manual"`, metodo `HEAD` (con
   ripiego `GET` annullando subito il corpo), al massimo 4 salti; a ogni salto
   l'header `Location` deve essere `https`, senza credenziali né porte, e con host
   nell'elenco dei tracker o dei portali. **Appena l'host è un portale ci si ferma
   senza richiedere la pagina del portale.**
5. **Limiti**: al massimo 2 tracker per email, concorrenza globale 3, tetto di 150
   risoluzioni per esecuzione, timeout 5 s, cache per URL nella stessa esecuzione.
   Oltre il tetto il candidato resta con `url_originale` e viene rielaborato al
   ciclo successivo (oggi esiste già il meccanismo di rielaborazione per versione).
6. **Interruttore e osservabilità**: variabile `NMRE_LINK_RESOLUTION` =
   `off` | `embedded_only` | `allowlist` (predefinito proposto: `allowlist`). Nel
   riepilogo `nmre_gmail_sync_runs` si aggiungono solo **conteggi** (risolti
   senza rete, risolti con rete, scartati come link d'azione, host tracker
   sconosciuti incontrati per nome di dominio, senza URL completi).
7. **Fallback manuale**: se il link non è risolvibile, la scheda mostra "Apri
   l'annuncio dall'email" e il titolare apre il link dal proprio browser (la
   funzione per aprire link non verificati esiste già, commit `6cdcf6f`).
8. **Tracciabilità**: in `dati_estratti.link_resolution` si salva il metodo usato
   (`embedded`, `redirect`, `none`) e il numero di salti.

**File coinvolti**
- `supabase/functions/nmre-gmail-scheduled/_shared/parser.ts` (`listingUrls`, `resolveListingUrl`, nuove funzioni `isActionLink`, `resolveTrackedUrl`).
- `supabase/functions/nmre-gmail-scheduled/index.ts:575-600` (limitatore di concorrenza, conteggi, interruttore).
- `supabase/functions/nmre-gmail-scheduled/parser_test.ts` (i due test che oggi verificano il `GET` vanno aggiornati).
- Migrazione che aggiunge le colonne di conteggio a `nmre_gmail_sync_runs` (**scrittura su schema, da approvare**; in alternativa i conteggi vanno in una colonna JSON esistente, se presente 🔎).
- Documentazione: `docs/property-map-and-subito.md`, `supabase/cron/README.md`, `README.md`.

**Test**
- Link di disiscrizione su host tracker in elenco → nessuna richiesta di rete (fetch simulato che fallisce il test se chiamato).
- Tracker non in elenco → nessuna richiesta.
- Catena `clicks.immobiliare.it` → `www.immobiliare.it/annunci/123456/` → si ferma senza richiedere il portale; un solo `HEAD`.
- Catena verso dominio non autorizzato, `http:`, porta non standard, credenziali nell'URL → `null`.
- Più di 4 salti → `null`.
- Tetto per esecuzione e concorrenza massima rispettati (contatore nel fetch simulato).
- Regressione: tutti i test attuali del parser e della cronologia passano.
- Verifica in produzione dopo il rilascio: confronto per 48 ore della percentuale di candidati con link diretto prima e dopo (Q11 + conteggi nuovi).

---

## 5. Strategia per proteggere l'app senza perdere l'accesso

### 5.1 Accesso di emergenza (da predisporre per primo)
- L'accesso alla **Dashboard Supabase** è indipendente dall'accesso all'app: da lì
  si può sempre riattivare la registrazione, inviare un link di recupero, creare
  un utente, modificare `NMRE_ALLOWED_USER_ID` o tornare a una versione precedente
  di una funzione. Va protetto con 2FA e con codici di recupero conservati offline.
- Annotare in un luogo sicuro (non nel repository) l'UID del proprio utente
  (Dashboard → Authentication → Users) e confermare che coincide con
  `NMRE_ALLOWED_USER_ID` (confronto da fare personalmente nella Dashboard).
- Verificare di conoscere la password dell'app; in caso contrario reimpostarla
  **prima** di qualsiasi altro passo.

### 5.2 Ordine di rilascio proposto (ogni passo è reversibile)

| Passo | Azione | Verifica subito dopo | Ritorno indietro |
|---|---|---|---|
| 0 | Eseguire lo script di audit (sola lettura) e condividere gli esiti | — | — |
| 1 | Recupero password in app (A6) su branch, anteprima, poi `main` | Test completo del recupero con il proprio account | Revert del commit |
| 2 | Rimozione del pulsante di registrazione (A1) | Accesso del titolare | Revert |
| 3 | Disattivazione registrazioni in Supabase (A2) | Accesso del titolare; tentativo di registrazione rifiutato | Riattivare l'opzione |
| 4 | `requireOwner` su `nmre-candidate-enrich`, poi `nmre-search-engine`, poi `nmre-push-send` (A3–A5), una per volta | Funzione usata dall'app con il proprio account | Ridistribuire la versione precedente |
| 5 | Allineamento frequenza Gmail e documentazione (§3) | Q9/Q11 dopo 24 ore | Ripristino pianificazione precedente |
| 6 | Nuova risoluzione dei link (§4), prima con `embedded_only` per 24 ore, poi `allowlist` | Conteggi nel monitor di sincronizzazione | `NMRE_LINK_RESOLUTION=off` |
| 7 | CSP in sola segnalazione, poi attiva (A8) | Tutte le sezioni senza errori | Rimozione del meta tag |
| 8 | MFA facoltativa (A7) | Accesso con TOTP | Rimozione del fattore dalla Dashboard |
| 9 | Policy RLS restrittive con elenco utenti autorizzati (A10) | Q3 + uso completo dell'app | Script di `drop policy` pronto |

### 5.3 Se lo script rivela altri utenti (Q12/Q13)
Nessuna cancellazione. Opzioni da valutare insieme: sospensione dell'utente dalla
Dashboard (reversibile), oppure lasciarlo isolato dalla RLS. I dati di altri
proprietari non vengono letti né esportati.

---

## 6. Minimizzazione del contenuto email (decisione richiesta)

✅ `nmre-gmail-scheduled/index.ts:623-635` salva mittente, oggetto, anteprima e fino
a 30.000 caratteri di testo in `annunci_candidati.dati_fonte`; la migrazione
`20261125014133` li copia in `annunci`; l'interfaccia li mostra
(`index.html:4682-4693`, `4877-4881`), mentre `index.html:724`, il README e
`supabase/cron/README.md` dichiarano il contrario.

Opzioni (nessuna cancella dati senza ulteriore approvazione):
1. **Conservazione limitata (consigliata)**: si conserva un estratto di massimo
   2.000 caratteri attorno all'annuncio, senza intestazioni personali, per 90
   giorni in coda; in archivio restano solo i campi estratti. Si aggiornano i
   testi dell'interfaccia e della documentazione.
2. **Conservazione completa dichiarata**: si mantiene il comportamento attuale e
   si corregge la documentazione, aggiungendo una scadenza.
3. **Nessuna conservazione**: si torna ai soli campi estratti.

La scelta incide sul Motore di acquisizione (modulo A): il testo sorgente aiuta a
riclassificare i casi dubbi quando il parser migliora. Per questo l'opzione 1 è
il compromesso proposto.

Inoltre `loadCandidates()` (`index.html:4950-4965`) scarica `dati_fonte` di tutti i
candidati ogni 60 secondi: in ogni caso la lista deve selezionare solo le colonne
necessarie e caricare il testo sorgente solo all'apertura del dettaglio.

---

## 7. Riepilogo dei file che verranno toccati (dopo approvazione)

| Area | File |
|---|---|
| Frontend | `index.html` (auth, recupero password, CSP, versioni dipendenze, testi frequenza/email, colonne caricate) |
| Funzioni | `supabase/functions/_shared/auth.ts` (nuovo), `nmre-push-send/index.ts`, `nmre-search-engine/index.ts`, `nmre-candidate-enrich/index.ts`, `nmre-gmail-scheduled/index.ts`, `nmre-gmail-scheduled/_shared/parser.ts`, `nmre-ai-assistant/` (da esportare) |
| Test | `nmre-gmail-scheduled/parser_test.ts`, nuovi `_shared/auth_test.ts`, `nmre-search-engine/validation_test.ts` |
| Database (solo file, applicazione separata) | `supabase/schema/produzione_schema.sql`, `supabase/migrations/…_baseline.sql`, migrazione conteggi di sincronizzazione |
| Cron | `supabase/cron/gmail-hourly-sync.sql` → `gmail-sync.sql` |
| CI | `.github/workflows/validate-app.yml` (tutte le funzioni, tutti i test, scansione segreti) |
| Documentazione | `README.md`, `supabase/cron/README.md`, `docs/gmail-push-setup.md`, `docs/property-map-and-subito.md`, `docs/nmre-ai-assistant.md` |
