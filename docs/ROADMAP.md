# NMRE · Roadmap verso la prima versione completa e stabile

Stato al 26/11/2026, su `main` `a447034`. Questo documento si basa sull'audit del codice
del repository. Ciò che riguarda la produzione è indicato come **riferito** o **da
verificare** quando non è stato letto direttamente.

## 1. Come è fatto NMRE oggi

| Parte | Dove | Note |
|---|---|---|
| App (PWA) | `index.html` (≈7.250 righe, HTML, CSS e JavaScript in un solo file), `sw.js` | Pubblicata da GitHub Pages solo dopo la CI (PR #72/#73) |
| Acquisizione Gmail | `supabase/functions/nmre-gmail-scheduled` (pianificata ogni 10 minuti), `nmre-gmail-push` (Pub/Sub) | Versione 69 da `f084623` (`docs/DEPLOYMENTS.md`, riferito) |
| Collegamento Gmail | `nmre-gmail-oauth-start`, `nmre-gmail-oauth-callback` | Token cifrati in `private.gmail_oauth_tokens` |
| Lettura delle pagine | `nmre-candidate-enrich` (manuale: JSON-LD e Open Graph) | Nessuna cache, nessun limite di frequenza, nessun controllo di `robots.txt` |
| Notifiche push | `nmre-push-send` (una push per ogni riga di `nmre_notifications`) | Orari di silenzio e preferenze per categoria |
| Insights | `nmre-insights-sync` | Bloccato senza autorizzazione commerciale (PR #68 in Draft) |
| Altro | `nmre-search-engine`, `nmre-gmail-reader` (dismesso, HTTP 410) | |
| Database | Supabase/Postgres | **Le tabelle principali non sono nel repository** (vedi §2) |
| Test | Deno (Gmail, Subito, protezioni), Node (frontend), PostgreSQL usa e getta (migrazioni) | Nessun test end-to-end dell'interfaccia in CI |

## 2. Problemi trovati, per priorità

### P0 · Rischio di perdere opportunità o dati
1. **Email Subito della v68 non acquisite.** L'email del 26/11 alle 09:24 è stata
   scartata dalla versione 68 e il cursore Gmail l'ha superata. Il recupero è preparato
   senza scritture nella PR #74 (prova reale da eseguire).
2. **Annunci Subito con novità non dimostrabile.** Diventano solo link in una scheda
   riepilogativa, al massimo 15. Correzione nella PR #75 (dietro interruttore, con
   migrazione per non generare notifiche a ondate).
3. **Email escluse dal filtro senza traccia.** Senza la Fase 2 (avvisi dubbi,
   `migrations_pending/20261125201000`) un'email scartata per errore non lascia nessun
   segno recuperabile.
4. **Schema di produzione non riproducibile.** `annunci`, `annunci_candidati`,
   `nmre_contacts`, `nmre_properties`, `nmre_appointments`, `annunci_interazioni`,
   `nmre_notifications`, `seller_identity_registry`, … e funzioni come
   `nmre_get_gmail_tokens` o `nmre_auto_archive_private_candidate` esistono solo in
   produzione. Ogni verifica sul comportamento reale resta quindi «non provata»: è
   così che è emerso il problema della funzione `VOLATILE`.

### P1 · Affidabilità e controllo
5. **Monitor della sincronizzazione senza allarme attivo.** Il monitor in
   Impostazioni legge `nmre_gmail_sync_runs`, ma nessuno avvisa se la sincronizzazione
   si ferma.
6. **Testi incoerenti.** L'app scrive «controllo server-side ogni minuto», mentre il
   job è ogni 10 minuti, più le notifiche Pub/Sub quando il watch è attivo.
   `supabase/cron/README.md` dice che corpo, mittente e oggetto delle email non vengono
   salvati, mentre `dati_fonte` salva mittente, oggetto e fino a 30.000 caratteri del
   corpo.
7. **Registro dei venditori non usato per Subito.** Le schede Subito non consultano
   `seller_identity_registry`.
8. **Nessun ambiente di prova.** Non esiste un progetto Supabase di staging.

### P2 · Struttura e manutenzione
9. **Un solo file da 7.250 righe.** I test estraggono le funzioni dall'HTML con
   espressioni regolari.
10. **Logica duplicata** tra app e sincronizzazione: deduplicazione, chiave
    dell'annuncio, classificazione.
11. **Funzioni dismesse** ancora presenti (`nmre-gmail-reader`).
12. **Pagine degli annunci:** nessuna cache né regole di accesso per portale; il nome
    dell'agenzia non viene letto.

## 3. Roadmap

Ogni voce è una PR separata, in Draft, con test. L'attivazione in produzione avviene
solo con autorizzazione esplicita.

### Fase 1 · Acquisizione completa (priorità assoluta)
| # | Intervento | Stato |
|---|---|---|
| 1.1 | Prova senza scritture dell'email Subito del 26/11 | PR #74 pronta: manca la prova reale |
| 1.2 | Una scheda «Da verificare» per ogni annuncio Subito plausibile, senza notifiche a ondate | PR #75 in Draft |
| 1.3 | Recupero mirato delle email Subito saltate dalla v68 (lettura per ID, schede di 1.2) | Dopo 1.1 e 1.2 |
| 1.4 | Fase 2: registro delle email escluse dal filtro (solo ID e regola) | Migrazione pronta, da approvare |
| 1.5 | Registro dei venditori anche per Subito; inserzionista privato, professionista o non identificato in tutte le schede | Da sviluppare |
| 1.6 | Allarme sulla sincronizzazione: avviso nell'app (nessuna esecuzione riuscita da più di 30 minuti, 3 errori consecutivi) | PR #77 in Draft · notifica push ad app chiusa: dopo lo schema (§5) |

### Coerenza tra PR #74 e #75
- **Stessa logica.** La prova (#74) e la sincronizzazione (#75) usano gli stessi moduli
  Subito: lettura della pagina, decisione sulla novità, confronto con Opportunità e
  Archivio.
- **Stesse proposte.** Le schede proposte dalla prova coincidono con quelle che la #75
  creerebbe: annunci plausibili, esclusi quelli già presenti o solo nell'Archivio.
- **Differenza nell'anteprima.** Nella prova, il tipo di venditore mostrato è quello
  calcolato senza il contrassegno `novita_non_dimostrata`. Dopo il merge della #75,
  la #74 passerà `unprovenReason` per mostrare «Da verificare» come in produzione.
  Non serve prima: la prova non scrive.
- **Ordine:**
  1. prova reale della #74;
  2. revisione della #75;
  3. migrazione `20261126210000`;
  4. deploy di `nmre-gmail-scheduled`;
  5. `NMRE_SUBITO_ITEM_CANDIDATES=true`.

### Fase 2 · Opportunità, Archivio e Rubrica
| # | Intervento |
|---|---|
| 2.1 | Esportazione in sola lettura dello schema di produzione nel repository (`supabase db dump --schema-only`, revisionata) e test sullo schema reale |
| 2.2 | Verifica end-to-end di archiviazione, inserimento manuale, recupero degli scartati e protezione delle modifiche manuali sullo schema reale |
| 2.3 | Rubrica: collegamento automatico per telefono solo con corrispondenza certa (PR #71, già su `main`), esteso ai numeri secondari (PR #78) |
| 2.4 | **Importazione della rubrica del telefono** (vCard 2.1/3.0/4.0, Contact Picker): anteprima, tutti i numeri ed email, aggiornamento solo additivo, importazione ripetibile | PR #78 in Draft |
| 2.5 | **Possibili duplicati** su tutti i numeri normalizzati e sulle email, solo segnalazione | PR #78 in Draft |
| 2.6 | **Unione guidata dei contatti**: confronto, scelta dei valori, anteprima, conferma esplicita; trasferisce appuntamenti, attività, collegamenti immobili e annunci; nessuna cancellazione senza conferma | Dopo lo schema (§5): servono le chiavi esterne reali |
| 2.7 | Tabella dei numeri di telefono per contatto (`nmre_contact_phones`), con migrazione dei «Altri numeri» dalle note | Migrazione da preparare dopo lo schema |
| 2.8 | Annuncio collegato al contatto anche nelle **Opportunità**, e segnalazione «più contatti con questo numero» da verificare | Dopo lo schema: verificare le colonne di `annunci_candidati` |

### Fase 3 · CRM e funzioni interne
| # | Intervento |
|---|---|
| 3.1 | Audit di ogni sezione (Panoramica, Opportunità, Archivio, Rubrica, Appuntamenti e follow-up, Analisi, Mappa, Impostazioni) con test di flusso nel browser in CI |
| 3.2 | Modulo condiviso tra app e funzioni per deduplicazione e chiavi |
| 3.3 | Divisione di `index.html` in moduli, un'area alla volta, senza cambiare il comportamento |

### Fase 4 · Restyling
Dopo le fasi 1–3: layout, navigazione, dashboard, tabelle e schede, tipografia,
desktop e smartphone. Su una base divisa in moduli e coperta da test.

### Fase 5 · NOVA
Assistente testuale e vocale, che usa le stesse funzioni dell'app e chiede conferma
prima di ogni azione che modifica dati. Il progetto è in `docs/nmre-ai-assistant.md`.
Parte dopo la Fase 3.

## 5. Acquisizione sicura dello schema di produzione (senza dati né secret)
Da eseguire dal titolare. Si ottiene **solo la struttura**: tabelle, colonne, vincoli, indici,
funzioni, trigger e policy RLS degli schemi `public` e `private`.

1. Installare la CLI di Supabase e collegare il progetto (`supabase link --project-ref <ref>`,
   chiede la password del database: non salvarla nel repository).
2. Esportare la sola struttura (nessuna riga dei dati):

   ```bash
   supabase db dump --linked --schema public,private -f nmre_schema_produzione.sql
   ```

3. **Controllo prima di condividere.** Il file deve contenere solo `CREATE`, `ALTER`,
   `COMMENT`, `GRANT` e `POLICY`. Questi comandi devono restituire **nessuna riga**:

   ```bash
   grep -nE "^(INSERT|COPY) " nmre_schema_produzione.sql
   ```

   ```bash
   grep -niE "sb_secret_|eyJ[a-zA-Z0-9_-]{20,}|password|refresh_token\s*[:=]" nmre_schema_produzione.sql
   ```

4. Caricare il file in una PR dedicata come `supabase/schema/produzione_<data>.sql`, non in
   `supabase/migrations/`: è un riferimento e non deve essere applicato.

Con lo schema reale:
- ricostruiremo la struttura nei test (database usa e getta);
- verificheremo chiavi esterne, vincoli, funzioni e trigger;
- aggiungeremo test end-to-end sui flussi Opportunità → Archivio → Rubrica, senza
  duplicare tabelle o colonne già esistenti.

## 6. Pull Request aperte
| PR | Contenuto | Stato |
|---|---|---|
| #68 | Connettore Immobiliare.it Insights | Draft, in attesa dell'autorizzazione commerciale |
| #74 | Prova senza scritture di una singola email Subito | Draft, pronta per la prova reale |
| #75 | Schede singole «Da verificare» per Subito (dietro interruttore) e migrazione per le notifiche | Draft, CI verde |
| #76 | Questa roadmap | Draft |
| #77 | Allarme sulla sincronizzazione in ogni schermata | Draft |
| #78 | Importazione della rubrica del telefono e possibili duplicati | Draft |

Le PR #75, #77 e #78 cambiano la versione del service worker: integrandole insieme va
scelta una versione unica.

## 7. Prossimi passi concreti
1. **Titolare:** eseguire la procedura della PR #74 (README della funzione, passi 1–8)
   e inviare il rapporto.
2. **Revisione della PR #75.** Poi, con autorizzazione: migrazione
   `20261126210000`, deploy di `nmre-gmail-scheduled`, `NMRE_SUBITO_ITEM_CANDIDATES=true`.
3. **Titolare:** esportare lo schema di produzione (§5).
4. **Sviluppo:** recupero mirato delle email Subito (1.3) dopo la prova; registro delle
   email escluse (1.4); unione guidata dei contatti (2.6) dopo lo schema; audit delle
   sezioni CRM (3.1).
