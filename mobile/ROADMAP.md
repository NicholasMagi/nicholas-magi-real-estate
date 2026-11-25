# NMRE Mobile — Roadmap

## Product
**NMRE Mobile** is a separate Expo client for iOS and Android, under mobile/ on branch mobile-expo-foundation. The existing Nicholas Magi Real Estate web/PWA remains unchanged. Both clients reuse the existing Supabase backend; there is no duplicate database or background service.

Target: develop from Windows with Expo and build iOS/Android through EAS. ALBim is a future adapter pending a verified provider contract.

## M0 — Audit (completed)
- Inspected repository, PWA, CI, Supabase tables/policies, deployed functions and Gmail cron.
- Confirmed static single-page PWA with inline JS and Supabase JS v2.
- Confirmed 19 public application tables with RLS and owner-scoped policies observed.
- Found 33 applied live migration records vs 7 migration files in repository.
- Function comparison: search, enrichment, Gmail scheduled worker, Gmail Push, Push Send, OAuth start/callback and retired reader match; Insights differs; AI is deployed but its source is not versioned.
- Live Gmail cron runs every minute; docs contain conflicting intervals.
- No production database/function/secret/root PWA change made.

## M1 — Audit documentation (completed)
Eight documents added under mobile/: AGENTS, ROADMAP, ARCHITECTURE, DATABASE_SCHEMA, API_SPECIFICATION, SECURITY, TEST_PLAN and CHANGELOG. Branch isolated from main. No production writes.

## M2 — Expo scaffold and first preview (in progress)
Added Expo SDK 58 / React Native 0.88 / React 19.3 baseline, Expo Router, TypeScript strict config, NMRE Mobile app identity, EAS development/preview/production profiles and the first four-screen UI shell (Oggi, Immobili, Opportunità, CRM).
The preview deliberately contains no Supabase data, mocked listings or fake counts. Data connection is labeled inactive.
Remaining gates: install dependencies on Windows, generate/commit package-lock.json, run typecheck/lint/Expo diagnostics, export iOS and Android bundles and fix any errors. This remote scaffold has not yet been locally built or executed.

Acceptance:
- Clean npm install on Windows and committed lockfile.
- Strict typecheck and lint pass.
- Expo diagnostics pass.
- iOS/Android exports pass.
- QR preview opens in Expo Go SDK 58 on physical device.
- No production data writes.
Rollback: revert mobile scaffold commit; no backend rollback.

## M2.5 — NOVA native assistant shell (implemented; data connection pending)
- Added the NOVA tab and native text chat UI.
- Added a pure TypeScript rules engine ported from the PWA decision logic: candidate priority, data completeness/duplicate checks, municipality filters, action-plan ranking, due/overdue follow-ups, private-seller counts, incomplete qualification and documented price reductions.
- Added a typed context boundary. Without connected operational repositories, NOVA clearly reports that data are unavailable rather than presenting fake counts; generic help and call-script prompts still work.
- No OpenAI/API, new Supabase table, Edge Function, migration, production write or secret was introduced.
- Added npm run test:nova based on Node's built-in test runner. Run it locally and record exact output before considering the milestone verified.
- Remaining: M3 Auth/SecureStore; M4 owner-scoped read-only repositories and mapping; detail navigation; install dependencies and run full mobile quality gates.
- Rollback: revert only the NOVA mobile feature files and tab entry; no backend rollback.

## M3 — Authentication and session (in progress)
Implemented in source on 2026-11-25:
- Supabase JS v2 client initialized only with the HTTPS project URL and publishable key.
- Expo SecureStore adapter with chunked session storage and pointer-last updates.
- Existing-user email/password login, local-device sign-out, auth-state restoration, native foreground/background token refresh and protected tab routes.
- Dedicated sign-in screen, dashboard sign-out action, and deterministic tests for safe auth error messages.
- No self-registration flow is exposed.

Remaining gates:
- Install dependencies on Windows and commit the generated package-lock.json.
- Configure the local .env with the project URL and publishable key; verify email/password Auth for the existing user.
- Run auth/NOVA tests, typecheck, lint, Expo Doctor and iOS/Android exports.
- Test valid/invalid credentials, offline startup, session persistence, token refresh/expiry and local sign-out on physical devices.
- Confirm SecureStore adapter behavior on iOS and Android and check logs/bundles for leaked tokens.
- M4 read-only repositories and live listing access remain separate and are not implemented.

Acceptance: valid sign-in/out, invalid credentials, expired session, refresh failure and network outage tested; staging proves User A cannot access User B records; no secret in bundle/logs and no PII disk cache. Source implementation exists, but integration/device gates are NOT YET VERIFIED.
Rollback: revert mobile auth code; leave Auth/backend untouched.

## M4 — Dashboard and real listings
Deliverables: dashboard counts, paginated listing archive and candidate queue, listing detail, filters, safe link opening and seller classification/evidence.
Acceptance: every displayed record traces to backend data; stable pagination; filters compose/reset; RLS isolation; no unverified seller treated as confirmed private or acquired mandate.
Rollback: revert mobile feature code only.

## M5 — Favorites and price history
Deliverables: favorites via proposed additive relation table; price timeline from actual candidate-notification and competitor history observations.
Acceptance: migration reviewed and staging-tested; owner isolation and unique owner/listing; removing favorite never deletes listing; historical data reconciles and missing observations remain missing.
Rollback: disable feature and retain user data unless explicitly approved otherwise.

## M6 — CRM productivity and device behavior
Deliverables: contacts, properties, interactions and appointments using current schema; native push registration design/implementation; phone/WhatsApp/share-sheet handoff; offline read-only mode only after encryption/retention design.
Acceptance: owner-scoped CRUD; timezone/date/DST tests; push permission denied and unregister tests; native tokens distinct from browser VAPID; cached data visibly stale; no silent offline writes.
Rollback: disable individual features; preserve server records.

## M7 — Stabilization and release
Deliverables: test plan, dependency audit, secret scan, accessibility review, EAS preview builds and physical-device checks.
Acceptance: release-blocking checks pass; high/critical risks fixed or formally accepted; iPhone and Android device tests; EAS build IDs/environment recorded; production profile explicit.
Rollback: stop rollout and issue corrected build; database rollback separate and approved.

## M8 — ALBim compatibility (future)
Verify product identity, official API contract, auth, ownership and provider permissions; define adapter, mapping, idempotency and conflict handling.
Acceptance: approved provider contract, sandbox and contract tests; core app works with adapter disabled.
Rollback: disable adapter; keep Supabase core unchanged.

## Global gates
No production migration without explicit approval and rollback. No merge to main without review. No undocumented integration or scraping. No completion claim without evidence. Isolated staging is required before write-capable development; only one Supabase project was verified.


### M4.1 — Dashboard read-only (source implemented; device verification pending)
- Added an authenticated, owner-filtered dashboard summary using exact-count SELECT queries against `annunci_candidati` and `annunci`.
- The candidate count includes only records still in `da_verificare` and not already promoted to an archived listing; discarded and promoted candidates are not counted as new opportunities.
- Dashboard shows loading/error states and supports pull-to-refresh. No persistent application-data cache is introduced.
- No INSERT, UPDATE, DELETE, Edge Function, schema, migration or production deployment is used.
- Remaining: run local quality checks and verify the real counts on the signed-in iPhone before marking M4.1 complete.
