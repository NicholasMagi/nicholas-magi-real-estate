# NMRE Mobile — Architecture proposal

## 1. Current system
Existing web/PWA is a static single-page app at repository root, published via GitHub Pages. Its index.html contains markup, CSS and a large inline JavaScript module; it imports Supabase JS v2 from a CDN and uses Auth, PostgREST and Edge Functions.

Backend is the system of record:
- Supabase Auth and PostgreSQL 17, EU West 1.
- 19 public application tables with RLS and owner-scoped policies observed.
- Private Gmail OAuth/token/sync state.
- Edge Functions for search, candidate enrichment, Gmail OAuth/worker/Push, notifications, Insights and AI.
- Server-side Gmail worker and Pub/Sub receiver.
The mobile app is a second client, not a new backend.

## 2. Goals / non-goals
Goals: native iOS experience, Android-compatible shared code, Windows development, EAS cloud builds, strict TS, typed repositories, resilient states and future ALBim adapter boundary.
Non-goals: rewriting PWA, cloning database/services, parsing Gmail on-device, exposing secrets, portal scraping, duplicating AI logic or assuming multi-tenant roles.

## 3. Identity
- Display name: **NMRE Mobile**
- Expo slug: `nmre-mobile`
- Source: `mobile/`
- Proposed scheme: `nmre-mobile`
- Provisional iOS bundle ID / Android applicationId: `it.nicholasmagi.nmremobile` (check account/store identifier availability before EAS build).
- Existing web app keeps its own name and deployment.

## 4. Technology baseline
As of 24 Nov 2026, Expo SDK 58 is the current stable reference and targets React Native 0.88 / React 19.3. Expo Router 58-compatible release is recommended. Use compatible exact package patches selected by Expo installer and commit package-lock; avoid canary.
- Expo SDK 58
- React Native 0.88, React 19.3
- Expo Router
- TypeScript strict
- @supabase/supabase-js v2
- expo-secure-store
- react-native-url-polyfill where required
- TanStack Query for pagination/cache/invalidation; no persistent CRM PII cache in MVP
- Jest + jest-expo + React Native Testing Library
- ESLint/Prettier
- EAS Build for iOS/Android

Official version reference: https://docs.expo.dev/versions/latest/ ; release note: https://expo.dev/changelog/sdk-58 ; Router docs: https://docs.expo.dev/router/introduction/.

## 5. Repository layout
```
mobile/
  AGENTS.md ROADMAP.md ARCHITECTURE.md DATABASE_SCHEMA.md
  API_SPECIFICATION.md SECURITY.md TEST_PLAN.md CHANGELOG.md
  package.json package-lock.json tsconfig.json app.json eas.json
  src/
    app/
    features/
      auth/ dashboard/ listings/ candidates/
      favorites/ price-history/ crm/ notifications/
    shared/
      api/ components/ config/ domain/ hooks/ utils/
    test/
```
Suggested routes: sign-in; native tab dashboard/listings/candidates/CRM; listing detail; listing price history; favorites. Screens do not issue ad-hoc Supabase calls.

## 6. Layers
Presentation: Expo Router, native navigation, accessible controls and explicit loading/empty/error/stale/offline states.
Application/data: feature hooks + TanStack Query; repositories isolate Supabase queries; mapping layer translates legacy Italian/English DB fields to stable view models; runtime validation at external/high-risk boundaries.
Backend: Auth JWT and RLS for owner data; PostgREST for validated owner-scoped tables; Edge Functions for privileged/multi-step actions; Gmail/OpenAI/provider secrets remain server-side.

## 7. Auth and config
One Supabase client singleton. Per-environment variables:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
Use development/staging/production EAS environments. Persist session via tested SecureStore adapter; one root auth observer; handle refresh on foreground; clear user-scoped query cache on logout.
Publishable key is public by design and never replaces RLS. Never bundle service_role/secret key, Google secrets, Gmail refresh token or OpenAI key. Existing AI function has a single-user NMRE_ALLOWED_USER_ID guard; do not bypass it or treat it as a role model.

## 8. Data strategy
Reuse current tables (see DATABASE_SCHEMA.md). Preserve seller class, confidence/evidence, manual overrides, candidate source, dedup key and notification provenance.
Price history reads actual observations from candidate notifications and competitor history. Missing event ≠ unchanged price.
Browser push table is Web Push/VAPID only. Native APNs/FCM/Expo tokens need a distinct model and server sender.
No favorites table exists yet; its proposed relation migration must be reviewed before feature enablement.

## 9. Resilience/performance
Server pagination 25–50 initially; stable sort created_at/id; narrow selects; user-scoped query keys; clear cache at logout; retry only transient errors; debounce and cancel searches; no unbounded full-table loops. MVP online-first. No offline write may be presented as committed.

## 10. Platform boundaries
Do not port DOM/localStorage/service-worker code. Use adapters for SecureStore, native push, share sheet, phone/WhatsApp intents, deep links and optional haptics. Native push differs from browser VAPID Push.

## 11. ALBim seam
No ALBim API contract was verified in audit. Add provider interface/adapter only after official docs and sandbox credentials are available. Keep vendor DTOs out of domain/screens; validate/version contracts, idempotency, provenance and conflict handling. Core app must work if ALBim adapter is disabled.

## 12. Environments
Development: Windows workstation + test account + isolated staging backend.
Preview: staging backend + EAS preview.
Production: existing Supabase project and secrets, selected only through deliberate release profile.
Only one Supabase project was verified. Create staging before any write-capable development. Production remains read-only during foundation.

## 13. Decisions (ADRs)
1. Separate mobile client under mobile/ and dedicated branch; preserve PWA.
2. Reuse Supabase system of record; no duplicate backend.
3. Expo SDK 58 + Expo Router.
4. SecureStore session + RLS.
5. Typed repositories and mapping layer.
6. Favorites as relation, not copied listing.
7. Native push distinct from VAPID Web Push.
8. Defer ALBim adapter pending provider contract.

## 14. NOVA — phase 1, deterministic assistant (2026-11-25)

Decision:
- The existing responsive PWA assistant is named **NOVA** and, in phase 1, uses deterministic command handlers in the browser rather than an external generative-AI API.
- It reuses already-loaded `candidateCache` and `listingCache`, the existing `candidatePriority()` commercial work-order score and the saved follow-up dates. It does not introduce a parallel data model.
- Supported tasks: acquisition priorities, top opportunities (including known municipality filters), a separate list of confirmed private sellers, due/overdue follow-ups, seller-classification counts, archive summary and a templated owner-call script. Opportunity results also show the existing data-completeness score, missing fields and possible duplicates.
- Operational planning also consolidates overdue callbacks, appointments due within three days, interested owners without a planned follow-up, repeated unanswered calls, recent documented price reductions, incomplete seller qualification and candidate leads. It ranks up to six next actions, explains the evidence and offers in-chat buttons to open the corresponding existing candidate or CRM record.
- Additional deterministic commands cover a daily action plan, municipality-scoped action plan, incomplete records and documented price drops. Opening a record is navigational only: NOVA does not call, message, send email, change CRM status or fill missing fields automatically.
- The conversation text is handled in the browser. The assistant does not invoke `nmre-ai-assistant`, OpenAI, or another AI endpoint. No new database table, Edge Function, secret or paid service is required for this phase.
- The score is a workflow ordering signal only; it is not an estimate of mandate probability and does not certify seller identity. Missing data remains missing.
- No voice, generative free-form dialogue, or persistent cross-device conversation memory is included in this phase.

Platform boundary:
- The same responsive PWA can be opened from a desktop browser or a mobile browser.
- The Expo client now includes a native NOVA chat tab and a typed deterministic rules engine under `mobile/src/features/nova/`. The assistant UI is usable, but its current context is explicitly `not_connected`; it does not read or invent live records. The same decision rules are ported from the PWA, not bundled as one shared runtime module.
- The previous `nmre-ai-assistant` Edge Function remains deployed but is not called by the phase-1 PWA assistant. No function deployment or production database change was made.


## 15. NOVA — native Expo client (2026-11-25)

- Added the NOVA tab and a React Native chat interface. Text-only in this milestone; no microphone, speech recognition, speech synthesis, wake word or persistent conversation storage.
- Added a typed, pure TypeScript engine for commercial priority scoring, candidate data quality and duplicate checks, municipality filters, action planning, due/overdue follow-ups, private-seller classification, missing CRM fields and documented price reductions.
- The native engine accepts a typed context snapshot. It has no Supabase client, network request, API key, storage write or AI provider dependency.
- The screen deliberately supplies `status: not_connected` until M3 authentication and M4 read-only repositories are implemented. Generic call-script and help prompts work without operational data; data-dependent questions explicitly explain that the archive is not connected.
- Candidate/listing actions are returned as typed identifiers for a future detail-navigation adapter. Current mobile record screens are placeholders, so the app does not claim those action identifiers open a specific record yet.
- Added `npm run test:nova` using Node's built-in test runner and TypeScript type stripping (Node 22.13+). Run it in the mobile workspace; the remote repository edit itself does not prove tests passed.
- No Supabase Auth, production table, Edge Function, PWA file, backend secret or deployment was changed in this native milestone.


## 16. M3 — Native authentication foundation (2026-11-25)

- The Expo client initializes one Supabase JS v2 client only when a valid HTTPS project URL and a modern sb_publishable key are present. Legacy JWT-shaped keys are rejected because a legacy service-role JWT must never be allowed into a public app bundle.
- Existing users authenticate with email and password. The app does not expose self-registration or alter Auth settings.
- Supabase Auth persists its session using an adapter backed exclusively by Expo SecureStore. Values are split into bounded chunks using Unicode code points; a generation pointer is written only after all chunks are stored. A read retries once if it detects a concurrent session-pointer replacement.
- The root navigation waits for session initialization, then protects the tab group. Sign-out is local to this device and does not revoke the user's other sessions.
- Native AppState changes start and stop Supabase's automatic token refresh while the app is foregrounded/backgrounded.
- No listing, candidate, CRM or other application table is queried in this milestone. No Supabase database, Auth setting, Edge Function, production secret, PWA file or deployment is changed.
- The local environment file must contain only the project URL and modern publishable key and must remain untracked. Dependency installation, npm lockfile, static checks and physical-device validation remain release gates; committed source is not evidence that those checks passed.
- Future user-scoped query caches must be cleared on sign-out. No persistent application-data cache exists yet; only the Auth session is persisted.


## 17. M4.1 — Read-only dashboard repository (2026-11-25)
- Added a typed dashboard repository under `src/shared/data/`; screens do not issue ad-hoc database queries.
- Queries use the current Auth user's id as an additional owner filter and remain protected by the deployed RLS policies (`auth.uid() = owner_id`). Authorization never relies on the client filter alone.
- Summary values use PostgREST exact counts with `head: true`; the app does not download listing records for the dashboard.
- Opportunity count means unreviewed candidates with `stato = da_verificare` and no linked archived listing. Discarded and already-promoted candidates are excluded.
- Dashboard refresh is user initiated. Application data stays in memory only; only the Auth session is persisted in SecureStore.
- This slice contains SELECT requests only and cannot write to application tables.
