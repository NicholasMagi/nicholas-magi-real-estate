# NMRE Mobile — Test plan

## 1. Strategy
Never create/update production test records. Use an isolated staging Supabase project with synthetic/anonymized fixtures before write-capable features. Evidence includes exact command, environment and output. Successful compilation alone is not proof of a working feature.

## 2. Static quality gates
Required package scripts:
- `npm run typecheck` — strict TypeScript.
- `npm run lint` — Expo ESLint.
- `npm run check:expo` — Expo Doctor.
- Add unit/component test runner before M3.
- `npx expo export --platform ios`.
- `npx expo export --platform android`.
- `npm audit` plus review of direct/transitive advisories.
- Secret scan and diff check that no changes outside mobile/ occurred.

**Current status:** package scripts/config are committed, but commands have NOT RUN because dependencies and lockfile have not yet been installed/generated in a local Windows workspace.

## 2.1 NOVA engine tests
Run from `mobile/` with Node 22.13 or newer:
- `npm run test:nova`
- The suite uses synthetic fixtures only and covers disconnected-data safety, generic call-script generation, parity of the commercial score, unverified seller handling, missing fields/duplicates, action-plan order, exclusive-agency suppression, private-only filtering, follow-ups and documented price reductions.
- These tests do not prove the Supabase repository mapping, authentication, or live record navigation; those belong to M3/M4 integration tests.

## 3. Unit tests to add
- Domain mapping for Italian/English schema fields, nullable values and malformed records.
- Seller class/manual override; ambiguous seller remains unverified.
- Price calculations based on actual snapshot semantics; no invented flat history.
- Filters, sorting, pagination and user-scoped query keys.
- Date-only follow-up, instants, Europe/Rome display and DST.
- Error normalization and retry policy.
- SecureStore get/set/remove and adapter failures.
- URL validation and deep-link host allowlist.

## 4. Component/navigation tests
- Sign-in validation, busy/error states.
- Protected routes and auth state transitions.
- Dashboard/list/candidate loading, empty and failure states.
- Pagination and filter reset.
- Listing detail and seller evidence.
- Price history with no observations vs actual observations.
- CRM/agenda forms, required fields and safe feedback.
- Push permission denied and preference states.
- Accessibility labels, touch targets and text scaling.

## 5. Integration/security tests (staging only)
- Session persists across restart using SecureStore.
- Sign-out clears user-scoped state.
- Owner A cannot read/update/delete Owner B data.
- Candidate promotion uses approved backend workflow and preserves overrides.
- Pagination has no duplicated/omitted rows.
- Failed queries do not render as successful zero records.
- Functions reject missing/invalid JWT and malformed input.
- Mobile never queries private schema.
- Favorites migration (after approval) enforces owner/listing uniqueness and parent owner integrity.
- Native push differs from Web Push and supports unregister/rotation.

## 6. Device tests
iOS: launch, safe areas, keyboard, navigation, external URL, session refresh, network changes, background/foreground and push lifecycle on physical iPhone.
Android: equivalent flows, back handling, keyboard/insets, external URL, session, network and push on physical device.
Test at least one physical iPhone and Android device before release. Expo Go may be used for early JS-only preview; native modules/custom entitlements require EAS development build.

## 7. EAS gates
Development: bundle IDs, scheme, Expo plugins, SecureStore and environment.
Preview: staging backend only.
Production: explicit approval, signing, entitlement/privacy and release review.
Record EAS build IDs, profile, environment and commit.

## 8. Regression gates
- Root web/PWA and GitHub Pages workflow unchanged.
- Existing functions and cron untouched.
- Mobile does not invoke Gmail worker or Pub/Sub receiver.
- No schema/migration/secret changes during M0/M1/M2.
- No production data writes during scaffold phase.
- NOVA mobile engine has no network client or database access until M3/M4 repositories are reviewed.

## 9. Milestone reporting
Report implemented features, files changed, exact tests and results, device evidence, known issues, residual risks, rollback and next milestone. Mark skipped checks NOT RUN with reason.
