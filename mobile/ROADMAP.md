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
Added Expo SDK 58 / React Native 0.88 / React 19.3 baseline, Expo Router, TypeScript strict config, NMRE Mobile app identity and EAS profiles. The preview contains no mocked listings or fake counts.
Remaining: full release gates and physical-device verification.

## M2.5 — NOVA native assistant shell
- Added NOVA tab and native text chat UI.
- Added a pure TypeScript rules engine for candidate priority, data completeness, duplicates, filters, action plans, follow-ups, seller classification and documented price reductions.
- No OpenAI/API request, new table, Edge Function, migration or production write.
- Data-dependent questions remain disconnected until live repositories are available.

## M3 — Authentication and session (implemented; further device/security gates remain)
- Supabase JS v2 client uses only HTTPS project URL and publishable key.
- Expo SecureStore persists Auth session.
- Existing-user email/password login, sign-out, session restore and foreground token refresh.
- No self-registration flow.

## M4 — Dashboard and real listings
Deliverables: dashboard counts, paginated listing archive and candidate queue, listing detail, filters and safe link opening.
Acceptance: backend traceability, stable pagination, RLS isolation and no unverified seller treated as a confirmed private or mandate.

### M4.1 — Dashboard (iPhone values verified)
- Authenticated owner-scoped exact counts for pending candidates, listings to contact, due callbacks and acquired mandates.
- First device verification showed 52 opportunities, 1 to contact, 0 due callbacks and 0 mandates.

### M4.2 — Candidate queue (source implemented; local verification pending)
- Read-only paginated list from public.annunci_candidati, filtered by current Auth user and RLS.
- Initial filter is unverified, unlinked candidates; additional state filters show confirmed, discarded and all candidates.
- Municipality search, stable order by creation descending then id ascending; page size 25.
- Details show listing facts and seller evidence required for review; projection excludes direct contact, email metadata and raw source/extraction JSON.
- "Privato confermato" appears only when seller type is Privato and candidate state is confermato.
- Source links open only on explicit tap and must be valid HTTPS URLs.
- No candidate is confirmed, promoted or discarded by this screen; no database writes.
- Remaining: local typecheck/lint/tests, Expo exports and iPhone checks for filters, search and pagination.

## M5 — Favorites and price history
Deliverables: favorites via proposed additive relation table; price timeline from actual candidate-notification and competitor history observations.
Acceptance: migration reviewed and staging-tested; owner isolation and unique owner/listing; removing favorite never deletes listing; missing observations remain missing.

## M6 — CRM productivity and device behavior
Deliverables: contacts, properties, interactions and appointments using current schema; native push design; phone/WhatsApp/share-sheet handoff; offline read-only mode only after privacy design.

## M7 — Stabilization and release
Deliverables: test plan, dependency audit, secret scan, accessibility review, EAS preview and physical-device checks.

## M8 — ALBim compatibility (future)
Verify official provider contract, auth, ownership and sandbox before implementing an adapter.

## Global gates
No production migration without explicit approval and rollback. No merge to main without review. No undocumented integration or scraping. No completion claim without evidence. Isolated staging is required before write-capable development.
