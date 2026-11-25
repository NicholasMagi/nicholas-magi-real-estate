# NMRE Mobile — Security and privacy

## 1. Protected assets / threats
Assets: Supabase session/refresh tokens, listing and seller records, contact details, appointment locations/notes, price history, seller evidence, Gmail integration metadata and device notification tokens.
Threats: lost device, compromised account, cross-owner data access (BOLA/IDOR), token leakage, malicious deep links, dependency supply chain, excessive local cache, untrusted portal content, notification leakage and accidental production writes.

## 2. Secrets
Allowed in compiled app: Supabase HTTPS URL and publishable key.
Forbidden: Supabase secret/service_role key, Google OAuth client secret, Gmail access/refresh token, OpenAI API key, VAPID private key, portal credentials, DB password or encryption key.
EXPO_PUBLIC variables are bundled and are not secrets. Keep provider secrets in Supabase/EAS server-side environment only.

## 3. Authentication
Reuse Supabase Auth. Store session via Expo SecureStore adapter; test restart, expiry, refresh, logout and lock behavior. Never log tokens. Clear user-scoped state on logout. Sensitive Edge Function requests require server-side user validation. Do not use editable metadata for authorization.
The current AI Edge Function has a single-user NMRE_ALLOWED_USER_ID guard. Do not bypass it for mobile or treat it as a multi-user roles model.

## 4. RLS and audit findings
All 19 public application tables inspected have RLS enabled and owner-scoped policies observed, usually auth.uid() = owner_id; listing interactions additionally validate parent ownership.
Supabase security advisor:
- private.gmail_sync_lock and private.gmail_push_watch_state have RLS disabled.
- Catalog inspection found anon/authenticated SELECT privileges false on both; migrations revoke table privileges from client roles. This reduces direct exposure but advisor should be resolved by reviewed service-only access controls, not a public read policy.
- Three private Gmail tables have RLS enabled but no policies; expected server-only access should be documented and grants rechecked.
- Leaked-password protection is disabled; enable after checking compatibility/user impact.
- 25 unused-index notices are informational in low-traffic project; do not delete solely from this.
No automatic remediation was applied.

## 5. SECURITY DEFINER
Privileged Gmail RPCs use SECURITY DEFINER. Catalog checks showed execution denied to anon/authenticated and granted to service_role for Gmail token/sync functions. Preserve that boundary. Review fixed search_path, strict validation and grants on every privileged RPC. Never return Gmail token ciphertext or OAuth state to clients.

## 6. Data at rest / privacy
No CRM PII or free-text data persisted in AsyncStorage/general storage. Server query cache is in memory by default. Clear state on logout. Minimize lock-screen push content; avoid phone/email/address/private notes in payload. Do not log full records or prompts containing personal data. AI disclosure/minimization must be explicit before mobile AI integration. Do not send contact lists to AI by default.

## 7. Network and validation
HTTPS only. Validate deep links and external URLs. Render portal/provider strings as text. Validate numeric and enum fields at app and server boundaries. Do not accept arbitrary URLs for server fetch; preserve host allowlists, redirect checks, timeouts and response-size limits.

## 8. Native push
Current VAPID subscription table/function is browser Web Push only. Native tokens need separate owner-scoped table and server APNs/FCM/Expo credentials, revocation and rotation. Payloads should contain only notification id and minimal safe preview.

## 9. Build/dependency security
Commit lockfile; use supported Expo versions; run npm audit and review transitive findings; secret scan; inspect app bundle/config; keep EAS signing assets in EAS/Apple account; separate dev/staging/prod credentials and explicit release profile.

## 10. Release blockers
No service-role or secret in bundle; no cross-owner access; critical/high dependency risks fixed or formally accepted; RLS/grants and session/logout tests pass; push/AI minimization reviewed; physical-device tests and EAS build evidence recorded.

## 11. Incident response and rollback
If a key leaks, revoke/rotate server-side; a new app binary alone is insufficient. If RLS regresses, disable the feature and restore reviewed policies; never work around with service_role in client. Record impact, remediation and verification.


## 12. Native session storage implementation (2026-11-25)
- The mobile client accepts only the modern sb_publishable public key format. Legacy JWT-shaped keys are rejected because the client cannot safely infer that a JWT is the public anon role rather than service_role.
- The mobile client stores only Supabase Auth session material through Expo SecureStore. It does not persist listings, seller details, phone numbers, addresses, CRM notes or NOVA conversation history.
- Larger session strings are split into small SecureStore entries (384 Unicode code points per chunk) and a final pointer is written only after the new encrypted chunks exist. Reads detect a concurrent pointer update and retry once.
- Local sign-out removes the current device session only. Any future application-data/query cache must be user-scoped and cleared on sign-out.
- The adapter and real-device session behavior have not yet been tested on iOS or Android. Source implementation must not be treated as release-verified.
