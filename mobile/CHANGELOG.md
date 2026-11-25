# NMRE Mobile — Changelog

## 2026-11-25 — M4.2 coda opportunità read-only
- Collegata la schermata Opportunità alla tabella esistente annunci_candidati con RLS e filtro aggiuntivo sull'utente autenticato.
- Aggiunti filtri per stato, ricerca per comune, paginazione di 25 righe, aggiornamento manuale e apertura esplicita del link HTTPS originale.
- Stato candidato e classificazione venditore sono mostrati separatamente; "Privato confermato" compare solo quando il tipo venditore è Privato e lo stato è confermato.
- La query usa una lista ristretta di campi e non legge recapiti, metadati email o JSON grezzi della fonte/estrazione.
- Nessuna modifica automatica della classificazione, promozione in archivio o altra scrittura su Supabase.

## 2026-11-25 — M4.1 dashboard read-only
- Connected dashboard metrics to owner-scoped Supabase counts for pending opportunities, listings to contact, due callbacks and acquired mandates.
- Added refresh, loading and connection-error UI.
- Kept this milestone read-only; no schema, production data, edge function or PWA changes.

## 2026-11-25 — M3 authentication foundation (in progress)
- Added Supabase JS v2 client configuration using only the project URL and public publishable key.
- Added an Expo SecureStore session adapter with chunking for larger values and pointer-last writes.
- Added existing-user email/password sign-in, protected navigation, auth-state restoration, foreground token refresh and device-local sign-out.
- Added a sign-in screen, dashboard sign-out action and tests for safe authentication error messages.
- Source implementation only: npm lockfile, Windows installation, static checks and physical-device authentication tests remain pending.
- No production database, Auth configuration, Edge Function, secret, PWA or deployment was changed.

## 2026-11-25 — NOVA native Expo shell
- Added the NOVA tab to the Expo app and a native text chat screen, visually aligned with NMRE's navy/gold mobile theme.
- Added a pure typed engine porting the PWA decision rules for candidate priority, data quality, possible duplicates, municipal filtering, action planning, callbacks, private classification, incomplete CRM qualification and documented price reductions.
- The mobile screen intentionally uses a not_connected context until authentication and owner-scoped read-only repositories are implemented. Data-dependent commands therefore explain the limitation instead of returning invented records. Generic help and a reusable call script work locally.
- Added a Node built-in test suite and npm run test:nova. The suite is committed but has not yet been executed in a local mobile workspace; no result is claimed.
- No OpenAI/API requests, Supabase client, database write, migration, Edge Function deployment, production secret or PWA change was made. Voice and persistent/shared conversation memory are deferred.

## 2026-11-25 — NOVA phase 1 (responsive PWA)
- Renamed the existing web assistant to NOVA and replaced its OpenAI Edge Function invocation with deterministic browser-side command handling.
- NOVA now uses the already-loaded candidate/archive caches and the existing commercial-priority score to summarize acquisition priorities, rank opportunities, show confirmed private sellers separately from unverified sellers, filter by known municipality, list due/overdue follow-ups, report seller-classification counts, summarize the archive and prepare a standard owner-call script. Opportunity results also include the existing data-completeness score, missing fields and possible duplicates.
- Expanded NOVA with a read-only daily action plan: overdue callbacks, appointments within three days, interested owners without follow-up, repeated unanswered calls, documented recent price drops, incomplete CRM qualification and candidate leads are consolidated and ranked.
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
- Recorded audit of the existing PWA, Supabase schema/RLS, deployed functions, Gmail cron and repository drift.
- Added roadmap, architecture, database inventory, API specification, security policy and test plan.
- No production database, deployed function, secret or PWA change was made.
