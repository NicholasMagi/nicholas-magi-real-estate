# NMRE Mobile — API specification

## 1. Security contract
NMRE Mobile uses the existing Supabase project and user identity. It does not create a new API server or database. Use authenticated JWT for PostgREST and approved authenticated Edge Functions; RLS is the authorization boundary. Never trust client owner_id alone.

Per-environment client values:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Only publishable credentials may ship. No service-role/secret, OAuth secret, provider password, Gmail token, VAPID private key or OpenAI key in client requests or app config.

Screens call typed hooks; hooks call feature repositories; repositories call Supabase. Normalize failures into auth, authorization, validation, not-found, rate-limit, network, server and unknown categories.

## 2. Existing data resources
All names below were found in deployed public schema with owner RLS observed. Verify current grants, FK names and generated types before implementation.

| Resource | Operation | Mobile purpose |
|---|---|---|
| annunci | SELECT / approved CRUD | listing archive and detail |
| annunci_candidati | SELECT / approved update | candidate queue |
| annunci_candidati_notifiche | SELECT | actual notification/price observations |
| annunci_interazioni | SELECT / approved CRUD | listing history |
| seller_identity_registry | limited read / approved changes | seller evidence, sensitive |
| nmre_contacts | CRUD | CRM contacts |
| nmre_properties | CRUD | CRM properties |
| nmre_contact_interactions | CRUD | CRM interaction log |
| nmre_appointments | CRUD | agenda |
| nmre_sales_goals | SELECT/UPSERT | activity targets |
| nmre_notifications | SELECT / update own read state | in-app notifications |
| nmre_notification_preferences | SELECT/UPSERT | preferences |
| nmre_gmail_sync_runs | SELECT | sync monitor |
| nmre_competitor_* | policy-dependent CRUD | competition |
| nmre_omi_quotazioni | policy-dependent CRUD | OMI analysis |
| nmre_compravendite_atti | policy-dependent CRUD | declared deeds |

Use field allowlists, not select('*'), in normal app queries. Never query private schema.

## 3. Existing Edge Functions
- `nmre-search-engine`: listing insert endpoint; checks JWT with auth.getUser(), validates fields and inserts with authenticated owner.
- `nmre-candidate-enrich`: authenticated enrichment for allowlisted HTTPS portal hosts; public metadata extraction does not prove seller identity.
- `nmre-gmail-oauth-start`: begins OAuth and returns authorization URL; mobile may open only validated Google authorization destination and needs a tested app return/deep-link flow.
- `nmre-gmail-oauth-callback`: server-side Google callback; not a normal mobile API.
- `nmre-gmail-scheduled`: background worker; never call from mobile.
- `nmre-gmail-push`: authenticated Pub/Sub receiver; not for mobile user requests.
- `nmre-push-send`: existing VAPID browser push sender; not native push contract.
- `nmre-insights-sync`: provider connector; deployed version differs from Git source; reconcile before relying on response shape.
- `nmre-ai-assistant`: active server function but source not versioned in repo; existing docs describe read-only allowlisted assistant; retrieve/version actual source and re-review minimization before mobile integration.
- `nmre-gmail-reader`: retired and returns HTTP 410; do not use.

Function contracts/versions may change. Confirm live source and response shape before coding. Functions not explicitly mobile-safe remain server-only.

## 4. Server-owned workflows not to recreate
Gmail parsing, cursor handling, deduplication, seller classification, candidate promotion, notification triggers and AI provider requests are backend responsibilities. Candidate auto-archive behavior currently differs between deployed Insights source and Git source; do not copy either into client.

## 5. Query and failure behavior
Use stable pagination, initial page size 25–50, narrow selects, user JWT and RLS. Add owner filter as defense-in-depth only. Verify child-parent ownership. Debounce and cancel stale requests. Retry transient network/5xx only; do not automatically retry 401/403/validation. Distinguish query error from valid empty result.

## 6. Planned favorites API (not deployed)
Proposed resource `nmre_favorites` after approved additive migration:
- GET: current owner's favorite listing links.
- POST: create unique owner/listing relation; handle duplicate idempotently.
- DELETE: remove relation only; never delete listing.
Favorite must target a listing belonging to same owner. Until migration exists, do not simulate persistence or show favorites as operational.

## 7. Native push (future)
Requires native APNs/FCM/Expo device tokens and server-side sender. Existing Web Push subscription is not equivalent. Define register/rotate/opt-out/unregister/invalid-token cleanup before enabling.

## 8. External links/actions
Validate HTTPS destinations. Phone and WhatsApp use OS handoff after explicit user tap; never auto-send. Do not log contact values.

## 9. Contract tests
For each resource/endpoint test success, unauthorized, cross-owner forbidden, empty result, validation error, rate limit, timeout, 5xx and malformed response. Keep sanitized response fixtures and record deployed schema/function version; fixtures are not live data.
