## 2026-11-27 — Importazione automatica rubrica nativa (mobile)
- Sostituita la schermata CRM segnaposto di NMRE Mobile con il collegamento alla rubrica nativa iOS/Android tramite Expo Contacts.
- Dopo il consenso del sistema, importa i contatti in pagine, confronta telefoni/email/nominativi con `nmre_contacts` e crea solo i record mancanti; completa esclusivamente campi CRM vuoti.
- Attivato il controllo automatico quando la schermata CRM viene aperta, quando l'app torna in primo piano e quando il sistema segnala modifiche alla rubrica. Non viene promesso un job in background.
- Gli annunci archiviati senza referente vengono associati solo se i numeri normalizzati individuano un unico contatto. Gli abbinamenti ambigui e i conflitti non vengono scritti.
- Tutte le modifiche sono confinate a `mobile/`; nessuna migration, Edge Function, tabella o deploy è stato eseguito.
- Limite dello schema CRM attuale: `nmre_contacts.phone` conserva un solo numero principale. Gli altri numeri letti dal dispositivo partecipano al matching durante la sincronizzazione, ma non vengono salvati come recapiti multipli permanenti. Per questo serve una futura migration additiva verificata su staging.
- La CI dedicata ha superato npm ci, suite test, typecheck e lint dopo aver corretto il conflitto React/React DOM, il campo email Expo e gli errori lint.
- Expo Doctor segnala una deriva di versioni SDK già presente nella base mobile (Expo e alcuni moduli 58.0.x); il controllo resta visibile come warning non bloccante, senza aggiornare in blocco lo stack SDK in questa PR.
- Build native e prove su dispositivi fisici restano necessarie prima del rilascio.

## 2026-11-25 — Archiviazione automatica solo con prova forte
- Ripristinata l'archiviazione automatica Gmail, ma solo dietro al gate della funzione SQL nmre_auto_archive_private_candidate.
- La funzione consente l'inserimento soltanto per etichetta esplicita di venditore privato con confidence almeno 99 o verifica manuale esplicita, e richiede titolo e comune.
- I segnali deboli o incerti restano in Opportunità; il monitor conta solo archiviazioni effettivamente riuscite.
- La verifica manuale di un privato nella PWA torna a invocare l'archiviazione protetta, dopo aver salvato e arricchito i dati disponibili.

## 2026-11-25 — Archivio solo su scelta esplicita
- Rimossa dal worker Gmail l'archiviazione automatica dei candidati riconosciuti come privati.
- La classificazione automatica o manuale del venditore non trasferisce più l'immobile nell'archivio; resta un'opportunità fino al comando esplicito dell'utente.
- Mantenuto auto_archived_count solo per compatibilità con il monitor storico, sempre a zero per le nuove sincronizzazioni.
- La PWA chiarisce che il salvataggio della verifica non archivia e che il trasferimento richiede Inserisci nell'archivio.
- La funzione SQL nmre_auto_archive_private_candidate resta nel database ma non è più chiamata dal worker; la sua disabilitazione a livello di permessi è un passaggio di hardening separato da pianificare dopo il deploy della nuova funzione.

## 2026-11-25 — M4.3 azioni sulle opportunità
- Aggiunte le azioni Archivia e Scarta nella scheda espansa delle opportunità ancora da verificare e non collegate all'archivio.
- Archivia usa la funzione PostgreSQL già esistente nmre_confirm_annuncio_candidato, con controllo auth.uid() e proprietà del candidato; crea la scheda in annunci, conserva collegamento source_candidate_id, provenienza e dati estratti, e aggiorna il candidato nella stessa transazione.
- Prima dell'archiviazione viene tentato il recupero dei soli metadati pubblici tramite nmre-candidate-enrich per i portali supportati; i valori rilevati completano solo i campi vuoti e l'estrazione viene conservata senza essere mostrata nella UI.
- La classificazione venditore esistente è mantenuta; archiviare non equivale a una verifica manuale del venditore privato.
- Scarta imposta stato=scartato sul solo candidato selezionato; il record non viene eliminato.
- Nessuna nuova tabella, migration, policy, funzione o deploy backend. Le scritture usano la sessione Auth e filtro owner_id; la funzione esistente verifica anche l'utente autenticato.
- Typecheck, lint, test automatici e verifica su iPhone per entrambe le azioni sono ancora da eseguire.

# NMRE Mobile — Changelog

## 2026-11-25 — M4.2 coda opportunità read-only
- Collegata la schermata Opportunità alla tabella esistente annunci_candidati con RLS e filtro aggiuntivo sull'utente autenticato.
- Aggiunti filtri per stato, ricerca per comune, paginazione di 25 righe, aggiornamento manuale e apertura esplicita del link HTTPS originale.
- Stato candidato e classificazione venditore sono mostrati separatamente; "Privato confermato" richiede la verifica manuale già registrata dal gestionale (override, confidenza 100 ed evidenza testuale specifica).
- La query usa una lista ristretta di campi e non legge recapiti, metadati email o JSON grezzi della fonte/estrazione.
- Nessuna modifica automatica della classificazione, promozione in archivio o altra scrittura su Supabase.

## 2026-11-25 — M3 authentication foundation (in progress)
- Added Supabase JS v2 client configuration using only the project URL and public publishable key.
- Added an Expo SecureStore session adapter with chunking for larger values and pointer-last writes.
- Added existing-user email/password sign-in, protected navigation, auth-state restoration, foreground token refresh and device-local sign-out.
- Added a sign-in screen, dashboard sign-out action and tests for safe authentication error messages.
- Source implementation only: npm lockfile, Windows installation, static checks and physical-device authentication tests remain pending.
- No production database, Auth configuration, Edge Function, secret, PWA or deployment was changed.

## 2026-11-25 — NOVA native Expo shell
- Added the NOVA tab to the Expo app and a native text chat screen, visually aligned with NMRE's navy/gold mobile theme.
- Added a pure typed TypeScript engine porting the PWA decision rules for candidate priority, data quality, possible duplicates, municipal filtering, action planning, callbacks, private classification, incomplete CRM qualification and documented price reductions.
- The mobile screen intentionally uses a not_connected context until authentication and owner-scoped read-only repositories are implemented. Data-dependent commands therefore explain the limitation instead of returning invented records. Generic help and a reusable call script work locally.
- Added a Node built-in test suite and npm run test:nova. The suite is committed but has not yet been executed in a local mobile workspace; no result is claimed.
- No OpenAI/API requests, Supabase client, database write, migration, Edge Function deployment, production secret or PWA change was made. Voice and persistent/shared conversation memory remain deferred.

## 2026-11-25 — NOVA phase 1 (responsive PWA)
- Renamed the existing web assistant to NOVA and replaced its OpenAI Edge Function invocation with deterministic browser-side command handling.
- NOVA now uses the already-loaded candidate/archive caches and the existing commercial-priority score to summarize acquisition priorities, rank opportunities, show confirmed private sellers separately from unverified sellers, filter by known municipality, list due/overdue follow-ups, report seller-classification counts, summarize the archive and prepare a standard owner-call script. Opportunity results also include the existing completeness score, missing fields and possible duplicates.
- Expanded NOVA with a read-only daily action plan: overdue callbacks, appointments within three days, interested owners without follow-up, repeated unanswered calls, documented recent price drops, incomplete CRM qualification and candidate leads are consolidated and ranked. Up to six recommendations include direct buttons to open the existing record.
- Added commands for acquisition priorities, municipality-scoped action plans, incomplete records and documented price reductions. Opening a record does not change it; no call, message, email or CRM update is sent automatically.
- User messages are not sent to OpenAI; the phase-1 assistant makes no AI API request and introduces no database table, Edge Function, secret or paid service.
- The score remains a work-order aid, not a prediction of mandate acquisition or proof of seller identity. Conversation history is session-only; voice and free-form generative chat are deferred.
- The responsive PWA can be opened from desktop and mobile browsers. The separate Expo app remains unconnected to Auth and live data; native NOVA integration is deferred until M3/M4.
- Verification: JavaScript module syntax parsed successfully in the tool runtime. Fixture checks passed for opportunity ranking, municipality filtering, overdue/today follow-ups, priority summary, seller counts, call-script generation and short contextual municipality follow-up. No live production data was changed and no deployment was performed.

## 2026-11-24 — M2 scaffold started
- Added Expo SDK 58 / React Native 0.88 / React 19.3 dependency baseline and Expo Router.
- Added app configuration for NMRE Mobile, scheme and provisional iOS/Android identifiers.
- Added EAS development, preview and production profiles.
- Added strict TypeScript, environment example and local preview instructions.
- Added initial mobile UI with four navigable areas: Oggi, Immobili, Opportunità and CRM.
- Preview explicitly shows no records and no fake counts; Supabase is not yet connected.
- No package installation, lockfile generation, local typecheck, lint, Expo export or EAS build has yet been run.
- No files outside mobile/, production DB, backend function, secret or deployment workflow changed.

## 2026-11-24 — M1 documentation baseline
- Named the app NMRE Mobile.
- Defined source directory mobile/ and dedicated branch mobile-expo-foundation.
- Recorded audit of the existing PWA, Supabase schema/RLS, deployed functions, Gmail job and repository drift.
- Added roadmap, architecture, database inventory, API specification, security policy and test plan.
- No production database, deployed function, secret, PWA file or deployment workflow changed.


## 2026-11-25 — M4.1 dashboard read-only
- Connected dashboard metrics to owner-scoped Supabase counts for pending opportunities, listings to contact, due callbacks and acquired mandates.
- Added refresh, loading and connection-error UI.
- Kept this milestone read-only; no schema, production data, edge function or PWA changes.

- Nota di disponibilità: la riga viene creata nell'archivio centrale Supabase già consultato dalla PWA; la schermata Immobili della app nativa resta una milestone distinta e non è ancora collegata.
