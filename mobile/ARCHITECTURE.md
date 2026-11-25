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
- The conversation text is handled in the browser. The assistant does not invoke `nmre-ai-assistant`, OpenAI, or another AI endpoint. No new database table, Edge Function, secret or paid service is required for this phase.
- The score is a workflow ordering signal only; it is not an estimate of mandate probability and does not certify seller identity. Missing data remains missing.
- No voice, generative free-form dialogue, or persistent cross-device conversation memory is included in this phase.

Platform boundary:
- The same responsive PWA can be opened from a desktop browser or a mobile browser.
- The separate Expo client remains a scaffold and is not yet connected to Auth or operational repositories. Native Expo integration of NOVA follows the authentication and read-only data milestones (M3/M4); do not claim the native client has NOVA until those gates are implemented and tested.
- The previous `nmre-ai-assistant` Edge Function remains deployed but is not called by the phase-1 PWA assistant. No function deployment or production database change was made.
