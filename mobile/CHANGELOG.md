# NMRE Mobile — Changelog

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
