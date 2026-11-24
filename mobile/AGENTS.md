# AGENTS.md — NMRE Mobile

## Identity and isolation
- Product: **NMRE Mobile**; Expo slug: `nmre-mobile`; source: `mobile/`.
- Dedicated branch: `mobile-expo-foundation`.
- Existing product: Nicholas Magi Real Estate web/PWA at repository root.
- This is a separate iOS/Android client, not a replacement or rewrite. The current web app and production backend must remain operational.
- Keep all mobile changes under `mobile/`. Root web files, GitHub Pages, deployed functions, production database, Google Cloud and production secrets are out of scope unless a separate backend task is explicitly approved.

## Mandatory engineering rules
1. React Native + Expo + TypeScript strict.
2. Keep iOS/Android compatible; isolate platform-specific behavior behind adapters.
3. Reuse current Supabase Auth, tables, RLS and approved Edge Functions. Do not duplicate database, CRM or background jobs.
4. Never invent listings, seller identity, prices, historical observations, analytics, API availability or test results. Fixtures must be labeled and isolated from production.
5. Only Supabase URL and publishable key may be bundled. Never include service_role/secret keys, OpenAI key, Google OAuth secret, Gmail refresh token, VAPID private key or portal credentials.
6. Use authenticated JWT and backend RLS for authorization. A client-provided owner_id is not an authorization boundary.
7. Privileged actions stay server-side. Never query private schemas or call privileged external APIs directly from the client.
8. No portal scraping, CAPTCHA bypass, undocumented endpoint probing or unauthorized personal-data harvesting.
9. Never log tokens, OAuth payloads, phone numbers, email addresses, street addresses or full CRM records.
10. Do not persist CRM PII in general-purpose unencrypted storage. MVP is online-first; offline persistent data needs a separate privacy/security design.
11. Distinguish loading, empty, error, stale and offline states. A failed request is not a successful empty result.
12. Screens are presentation-only; use typed feature repositories and hooks for data access.
13. Pin packages with a committed lockfile; install native dependencies using Expo-compatible versions.
14. Do not mark a feature complete without tests and verifiable evidence.

## Database and migration safety
- Deployed database is production data; initial mobile development is read-only.
- Audit found 33 applied migration records in the live database but only 7 migration files in the repository. Do not assume the repo migration folder can recreate production.
- Before type generation or writes, export and review a schema snapshot from the actual project.
- Never infer the live schema from an old migration alone.
- New schema must be additive, owner-scoped and reviewed, including constraints, indexes, RLS, grants, tests and rollback.
- Mobile clients never execute migrations.
- Favorites and native-push device registration are planned, not existing tables.
- Preserve seller evidence/manual overrides, deduplication, source provenance and price-observation timestamps.

## Auth and privacy
- Reuse Supabase Auth; persist session through a tested Expo SecureStore adapter.
- Clear user-scoped memory/query caches on sign-out.
- No persistent CRM PII cache by default.
- Do not use user-editable metadata for authorization.
- Current AI function's NMRE_ALLOWED_USER_ID allowlist is a single-user guard, not an organization/role model.

## Required checks
Run relevant package scripts: TypeScript typecheck, ESLint, unit tests, Expo dependency diagnostics, iOS and Android export/bundle checks, EAS native build at native milestones, secret scan and dependency audit before release. Report any check that cannot run; never assume it passed.

## Change workflow
1. Read ROADMAP, ARCHITECTURE, API_SPECIFICATION and SECURITY.
2. Document intent, files, data touched and security effects.
3. Make the smallest reversible change.
4. Add tests; update CHANGELOG and roadmap.
5. Run checks and record exact results.
6. Review full diff; reject unintended changes outside mobile/.
7. Do not merge to main or deploy production without explicit review and release authorization.

Record material decisions in ARCHITECTURE.md with context, chosen option, alternatives and consequences. Keep schema/API documents synchronized.
