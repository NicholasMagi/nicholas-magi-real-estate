# NMRE Mobile — Test plan

## 1. Principles
Do not create/update production test records. Use an isolated staging Supabase project with synthetic/anonymized fixtures before write-capable features. Test evidence must include command, environment, result and failure details. No test result may be inferred from successful compilation alone.

## 2. Static quality gates
- `npx tsc --noEmit` (strict TypeScript)
- `npx eslint .`
- `npx jest --runInBand`
- `npx expo-doctor` / dependency compatibility check
- `npx expo export --platform ios`
- `npx expo export --platform android`
- `npm audit` with review of direct/transitive findings
- Secret scan and diff check that no change outside mobile/ occurred.
Commands should be reflected in package scripts and CI after bootstrap.

## 3. Unit tests
- Domain mapping for Italian/English schema fields, nullable values and malformed records.
- Candidate seller class and manual override rendering; ambiguous seller remains unverified.
- Price calculations and percentage change using real snapshot semantics; no fabricated flat history.
- Filters, sorting, pagination and query-key scoping.
- Date-only follow-up fields, UTC instants, Europe/Rome display and DST boundary cases.
- Error normalization and retry policy.
- URL validation and deep-link allowlist.
- SecureStore adapter behavior for get/set/remove and failures.

## 4. Component and navigation tests
- Sign-in form validation, busy state and error state.
- Protected routes and auth-state transitions.
- Dashboard loading/empty/error states.
- Listing and candidate lists; pagination and filter reset.
- Listing detail and seller evidence.
- Price history no-observation state and real observation rendering.
- CRM/agenda forms with required fields and safe error feedback.
- Notification settings and permission denied state.
- Accessibility labels, touch targets and text scaling checks.

## 5. Integration and authorization tests (staging only)
- Auth session persists across app restart in SecureStore.
- Sign-out clears all user-scoped memory/cache.
- Owner A can read/write own records; cannot read/change/delete Owner B records.
- Candidate confirmation uses approved server workflow and preserves manual override.
- List pagination has no duplicate or omitted rows at page boundaries.
- Query errors never render as zero successful records.
- Functions reject missing/invalid JWT and malformed payload.
- Read paths do not call private schema.
- Favorite migration (when approved) guarantees unique owner/listing and parent owner integrity.
- Native push registration is separate from Web Push and supports unregister/rotation.

## 6. Platform/device tests
iOS: app launch, safe areas, keyboard, navigation, URL handoff, session refresh, network changes, push permissions/token lifecycle, background/foreground, physical iPhone.
Android: equivalent navigation, back behavior, keyboard/insets, URL handoff, session, network, push and physical device.
Test at least one current physical iPhone and one Android device before release. Expo Go is suitable for early screens/JS workflows where native module support permits; custom native modules require an EAS development build.

## 7. EAS/build gates
Development build: bundle IDs, app scheme, Expo config, plugins, SecureStore, environment profile.
Preview: staging backend only, no production secrets.
Production: explicit confirmation, app signing, entitlement/privacy review and release approval.
Store EAS build IDs, profile, commit SHA and actual build outcome.

## 8. Regression tests
- Existing web/PWA files and GitHub Pages workflow unchanged.
- Existing backend functions and cron untouched.
- No mobile action triggers Gmail worker/Push receiver directly.
- Existing schema/migration list unchanged during M0/M1.
- No new production data or schema writes during documentation/foundation phase.

## 9. Acceptance reporting
For each milestone report:
- implemented functions,
- changed files,
- exact test commands and pass/fail,
- manual/device evidence,
- known issues,
- residual risks,
- rollback procedure and next milestone.
If not run, label NOT RUN and state why.
