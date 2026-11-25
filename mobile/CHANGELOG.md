# NMRE Mobile — Changelog

## 2026-11-25 — NOVA phase 1 (responsive PWA)
- Renamed the existing web assistant to NOVA and replaced its OpenAI Edge Function invocation with deterministic browser-side command handling.
- NOVA now uses the already-loaded candidate/archive caches and the existing commercial-priority score to summarize acquisition priorities, rank opportunities, filter by known municipality, list due/overdue follow-ups, report seller-classification counts, summarize the archive and prepare a standard owner-call script.
- User messages are not sent to OpenAI; the phase-1 assistant makes no AI API request and introduces no database table, Edge Function, secret or paid service.
- The score remains a work-order aid, not a prediction of mandate acquisition or proof of seller identity. Conversation history is session-only; voice and free-form generative chat are deferred.
- The responsive PWA can be opened from desktop and mobile browsers. The separate Expo app remains unconnected to Auth and live data; native NOVA integration is deferred until M3/M4.
- Verification: JavaScript module syntax parsed successfully in the tool runtime. Fixture checks passed for opportunity ranking, municipality filtering, overdue/today follow-ups, priority summary, seller counts, call-script generation and short contextual municipality follow-up. No live production data was changed and no deployment was performed.

All notable changes to the independent mobile project are recorded here. Dates use YYYY-MM-DD.

## 2026-11-24 — M2 scaffold started
- Added Expo SDK 58 / React Native 0.88 / React 19.3 dependency baseline and Expo Router.
- Added app configuration for NMRE Mobile, scheme and provisional iOS/Android identifiers.
- Added EAS development, preview and production profiles.
- Added strict TypeScript, environment example and local preview instructions.
- Added initial mobile UI with four navigable areas: Oggi, Immobili, Opportunità and CRM.
- Preview explicitly shows no records and no fake counts; Supabase is not yet connected.
- No package installation, lockfile generation, local typecheck, lint, Expo export or EAS build has yet been run.
- No files outside mobile/, production DB, backend function, secret or deployment changed.

## 2026-11-24 — M1 documentation baseline
- Named the app **NMRE Mobile**.
- Defined source directory mobile/ and dedicated branch mobile-expo-foundation.
- Recorded audit of the existing PWA, Supabase schema/RLS, deployed functions, Gmail job and repository drift.
- Added roadmap, architecture, database inventory, API specification, security policy and test plan.
- No production database, deployed function, secret, PWA file or deployment workflow changed.
