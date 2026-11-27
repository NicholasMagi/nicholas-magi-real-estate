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


## 10. M3 authentication checks
Automated source tests:
- Run npm run test:auth (Node 22.13+) for friendly handling of invalid credentials, unconfirmed email, rate limiting, network errors and unknown provider errors.
- Run npm run test for the NOVA and auth unit suites.

Still required after local dependency installation:
- npm run typecheck, npm run lint, and npm run check:expo.
- npx expo export --platform ios and npx expo export --platform android.
- Verify the app refuses missing configuration and rejects legacy JWT/service-role keys.
- Verify valid and invalid email/password, offline startup, expired refresh token, failed refresh, restart persistence and device-local sign-out.
- Exercise SecureStore chunked read/write/remove paths, interrupted writes and storage errors on iOS and Android.
- Confirm sign-out removes the Auth session and returns to the sign-in route; no CRM PII is persisted.
- Cross-owner RLS isolation remains an M4 staging integration test and has not been inferred from client-side route protection.


## 11. M4.2 candidate queue tests
- Run npm run test:candidates and npm test. Candidate unit tests cover the exact manual private-verification evidence contract, separation of workflow status from seller identity, agency/unverified labels, HTTPS URL validation and euro formatting.
- Run npm run typecheck and npm run lint.
- On the signed-in iPhone, verify the default unverified queue, pull-to-refresh, municipality filtering, confirmed/discarded filters, load-more behavior and source-link handoff.
- Confirm a query error shows an error state rather than a zero count; confirm the seller-type badge never labels Da verificare as a confirmed private seller.
- Confirm no contact/email/raw JSON fields are included in the candidate projection.
- Production behavior remains read-only; no update/promotion/discard action is present.


## M4.3 — Candidate actions (manual device checks pending)
- [ ] On a pending unlinked candidate, Archivia and Scarta appear only after expanding details.
- [ ] Canceling either confirmation leaves the record unchanged.
- [ ] Scarta changes the record to Scartato without deleting it; it remains visible under the Scartati filter.
- [ ] Archivia creates one record in Archivio annunci, keeps the original source URL/provenance and links the candidate; it disappears from Da verificare and appears as Confermato/Tutte.
- [ ] An unsupported or unavailable source-enrichment response does not block archive when title and municipality already exist.
- [ ] Missing title or municipality blocks archive with a clear message.
- [ ] Archiving a candidate classified as Privato but not manually verified does not show it as Privato confermato.
- [ ] Repeating archive after success does not create a second listing.


## 12. Native phone contacts sync (draft implementation)
- [ ] Install dependencies with npm ci and confirm expo-contacts resolves from the committed lockfile.
- [ ] Run npm run test:contacts and npm test.
- [ ] Run npm run typecheck, npm run lint and npm run check:expo.
- [ ] Build iOS and Android development clients; Expo Go is not sufficient proof for a release binary.
- [ ] Test permission not requested, granted, denied, permanently denied and revoked from Settings.
- [ ] Test import of empty, name-only, phone-only, email-only, multiple-number and duplicate-number contacts.
- [ ] Verify a repeated sync creates no duplicate CRM rows and never overwrites populated CRM fields.
- [ ] Verify Italian local/+39/0039 formatting and multiple numbers in one listing contact field.
- [ ] Verify an archived listing is linked only when exactly one CRM contact matches; ambiguous matches remain unlinked.
- [ ] Verify foreground refresh and contact-change listener on physical iOS and Android devices.
- [ ] Confirm no contact data is persisted locally and no production migration or deployment is needed for this mobile client change.
