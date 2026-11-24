# NMRE Mobile — Roadmap

## Product
**NMRE Mobile** is a separate Expo client for iOS and Android. Source code lives in `mobile/` on `mobile-expo-foundation`. The existing Nicholas Magi Real Estate web/PWA remains unchanged. Both clients reuse the existing Supabase backend; no duplicate database or background service is planned.

Development target: Windows PC, Expo and EAS cloud builds. ALBim support is a future adapter, pending a verified provider contract.

## M0 — Audit (completed)
- Inspected repository, PWA, CI, Supabase tables/policies, migrations, deployed Edge Functions and Gmail cron.
- Confirmed the web app is a static single-page PWA with a large inline JS module and Supabase JS v2.
- Confirmed 19 public application tables, all RLS-enabled with owner-scoped policies observed.
- Found 33 applied live migrations versus 7 repository migration files.
- Function source comparison: search, enrichment, Gmail worker, Gmail Push, Push Send, OAuth start/callback and retired reader match; Insights differs; AI is deployed but its source is not versioned.
- Live Gmail cron runs every minute; repository documentation reports conflicting intervals.
- No DB/function/secret/root PWA change made during audit.

## M1 — Documentation and isolated foundation (current)
Deliverables: all eight project documents, dedicated branch, app identity and architecture/rollback gates.
Acceptance: eight docs committed under mobile/; no changes outside mobile/; no production writes or deployments.
Rollback: abandon/delete isolated branch.

## M2 — Expo bootstrap
Deliverables: Expo SDK 58 stable baseline; React Native 0.88 / React 19.3 family; Expo Router; TypeScript strict; app identity NMRE Mobile; EAS profiles (development, preview/staging, production); .env.example with names only; lockfile; CI for lint/typecheck/tests/export.
Acceptance: clean install on Windows, Expo diagnostics pass, iOS/Android exports pass, development EAS build can be initiated; no production data writes.
Rollback: revert mobile bootstrap commit; no backend rollback.

## M3 — Authentication and session
Deliverables: existing email/password Supabase Auth, SecureStore storage adapter, protected routes, refresh/expiry UX and generated types from a verified live schema snapshot.
Acceptance: sign-in/out, invalid credentials, expired session, refresh failure and network outage tested; staging proves User A cannot access User B records; no secret in app bundle/logs and no PII disk cache.
Rollback: revert mobile auth code; leave Auth/backend untouched.

## M4 — Dashboard and actual listings
Deliverables: dashboard counts, paginated listings archive and candidate queue, listing detail, filters, safe link opening, seller classification/evidence.
Acceptance: every displayed record traces to backend data; stable pagination; filters compose/reset; RLS isolation; no unverified seller treated as confirmed private or acquired mandate.
Rollback: revert mobile feature code only.

## M5 — Favorites and price history
Deliverables: favorites via a proposed additive relation table; price timeline from actual candidate-notification and competitor history observations.
Acceptance: migration reviewed and staging-tested; owner isolation and unique owner/listing; removing favorite never deletes listing; historical data reconciles and missing observations remain missing.
Rollback: disable feature; retain user data unless explicit approved retention/export decision.

## M6 — CRM productivity and device behavior
Deliverables: contacts, properties, interactions and appointments using current schema; native push design/implementation; phone/WhatsApp/share-sheet handoff with user tap; offline read-only mode only after encryption/retention design.
Acceptance: owner-scoped CRUD; timezone/date/DST tests; native tokens distinct from browser VAPID; preference/unregister tests; cached data visibly stale; no silent offline writes.
Rollback: disable individual mobile features; preserve existing server records.

## M7 — Stabilization and release
Deliverables: full test plan, dependency audit, secret scan, accessibility review, EAS preview builds and physical-device checks.
Acceptance: release-blocking checks pass; high/critical risks fixed or accepted; iPhone and Android device tests; EAS build IDs/environment recorded; production profile explicit.
Rollback: stop rollout and issue corrected build; database rollback is separate and approved.

## M8 — ALBim compatibility (future)
Verify product identity, official API contract, auth, data ownership and permitted scopes; define adapter, mapping, idempotency and conflict handling.
Acceptance: approved provider contract, sandbox access and contract tests. Core NMRE remains usable when adapter is off.
Rollback: disable adapter; keep Supabase core unchanged.

## Global gates
No production migration without explicit approval and rollback. No merge to main without review. No undocumented integration or scraping. No completion claim without evidence. Isolated staging is required before write-capable development; only one Supabase project was verified in this audit.
