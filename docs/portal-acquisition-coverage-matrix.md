# Portal acquisition coverage matrix

Audit date: 2026-11-27  
Scope: residential sale listings published in the provinces of Ancona and Macerata.  
Purpose: document what NMRE can actually ingest today, distinguish tested integrations from generic email recognition, and identify the next authorized acquisition path.

## Executive findings

- Gmail ingestion is a shared pipeline. The nine recognized hostnames below span eight portal brands and are possible sources, but this does **not** mean that nine portal-specific connectors have been implemented or tested.
- Only Subito has a dedicated saved-search digest parser and a dedicated result-page acquisition path.
- Immobiliare.it Insights has a dedicated API adapter in `nmre-insights-sync`. It is credential-gated and requires written provider approval for lead-generation/acquisition use before imports are enabled.
- Idealista documents a Search API and requires an access request. NMRE has no active Idealista API adapter.
- Green-Acres' documented XML feed is for publishing an agency's own listings to Green-Acres; it is not an inbound search feed for private sellers.
- The current municipality lists are broader than the two target provinces. Territory restriction must be made explicit and tested in each connector rather than inferred from the global list.
- Subito's current automated GET of saved-search result pages may constitute automated extraction under its terms even though NMRE does not bypass CAPTCHA, authentication or anti-bot controls. Keep this path disabled pending explicit written authorization; do not treat low request volume or a two-province limit as authorization.

## Per-portal matrix

| Portal | Current NMRE path on `main` | Private-seller identification | Ancona/Macerata coverage | Authorization / next action |
|---|---|---|---|---|
| Subito | Gmail alerts; dedicated saved-search digest; code also GETs public result pages and parses listings | Digest itself remains "Da verificare"; listing parser can use portal labels, but verify each result | Search filters depend on saved-search email; no universal hard province gate in the Subito adapter | Terms expressly prohibit robots, spiders, scrapers and automated extraction without authorization. Pause automated result-page fetching until written permission. Continue only user-authorized/manual or email-based workflows that comply with terms. |
| Idealista | Gmail generic alert parser; portal domain and listing URL are recognized | Generic text signals only; no dedicated Idealista seller adapter | Email content can identify municipalities; no dedicated province allowlist | Search API exists; request access and obtain written permitted-use terms. No API credentials/schema assumed. |
| Immobiliare.it | Gmail generic alert parser plus dedicated Immobiliare.it Insights API adapter | Official API filter `clientTypeID=1` for private publisher; separate professional lookup; phone availability is only a flag and does not return the number | API provider adapter has a municipality allowlist broader than Ancona/Macerata; narrow and test before production use | API credentials and entitlement required. `INSIGHTS_LEAD_USE_APPROVED=true` must remain off until written confirmation that acquisition/prospecting use is permitted. |
| Casa.it | Gmail generic alert parser | Generic text signals only | Municipality may be parsed from email text; no portal-specific territory adapter | Obtain provider feed/API terms if available; otherwise improve only from representative Gmail alert fixtures. |
| Green-Acres | Gmail generic alert parser; documented XML integration is outbound listing publication | Generic text signals only | Municipality may be parsed from email text; no portal-specific territory adapter | Do not mistake the outbound XML feed for inbound private-listing search. Ask provider about authorized inbound data access. |
| Gate-away | Gmail generic alert parser | Generic text signals only | Municipality may be parsed from email text; no portal-specific territory adapter | Ask provider about authorized alerts/feed/API and commercial reuse. |
| Trovacasa | Gmail generic alert parser | Generic text signals only | Municipality may be parsed from email text; no portal-specific territory adapter | Ask provider about authorized alerts/feed/API and commercial reuse. |
| Wikicasa | Gmail generic alert parser | Generic text signals only | Municipality may be parsed from email text; no portal-specific territory adapter | Ask provider about authorized alerts/feed/API and commercial reuse. |

## Code evidence

- `supabase/functions/nmre-gmail-scheduled/index.ts` defines the nine recognized portal domains and contains `fetchSubitoPage()`, a normal HTTP GET of a Subito results URL. It follows redirects and caps response size; it does not implement CAPTCHA or anti-bot bypass.
- `_shared/parser.ts` uses one generic alert rule (new-listing wording plus a recognized portal listing URL) and generic seller text signals. It does not contain nine separate portal-specific email parsers.
- `_shared/mailbox.ts` adds a dedicated Subito saved-search digest parser.
- `_shared/subito.ts` contains Subito-specific digest, result-page parsing and blocked-page detection.
- `_shared/subito_acquisition.ts` retries saved-search page acquisition up to six attempts and processes at most eight pages per run. This is automated page extraction and should not be used without Subito's express permission.
- `supabase/functions/nmre-insights-sync/index.ts` implements the Immobiliare.it Insights adapter. It checks credentials, owner identity and the `INSIGHTS_LEAD_USE_APPROVED` gate before importing. New API-only candidates are restricted to private listings for which the portal reports phone availability; the API mapping does not return the phone number.
- `supabase/functions/nmre-insights-sync/provider.ts` contains a municipality allowlist including Ancona, Macerata and municipalities outside those two provinces. The current allowlist is therefore not a strict two-province boundary.
- Current email parser tests include generic URL parsing and municipality examples; the checked-in real email/result-page fixtures are Subito-specific. No representative real alert fixture was found for Idealista, Immobiliare.it, Casa.it, Green-Acres, Gate-away, Trovacasa or Wikicasa.

## Recommended implementation order

1. **Subito safety gate:** do not automatically fetch or parse saved-search result pages until Subito has explicitly authorized this use in writing. Keep email notifications and user-driven/manual import separate from automated page extraction.
2. **Territory filter:** define one explicit allowlist for the provinces of Ancona and Macerata, with municipality-to-province mapping and tests. Apply it consistently to Gmail and API imports. Do not rely on a substring match alone.
3. **Immobiliare.it Insights:** request written confirmation that the licensed API data may be used for seller acquisition/prospecting; verify the account entitlement and credentials; keep the existing server-side gate closed until confirmed. Then narrow the allowlist to the target provinces.
4. **Idealista:** submit the official Search API access request, describing NMRE and the two-province use case. Build the adapter only from provider-issued documentation and credentials.
5. **Email connector quality:** collect one representative alert email per portal from the user's own subscribed searches. Add sanitized fixtures and portal-specific tests for sender, subject, listing URL, date, location and seller classification. Do not fabricate fixture formats.
6. **Remaining portals:** request written feed/API permissions where useful. Green-Acres outbound publishing is not a substitute for inbound listing search.
7. **Unified candidate flow:** normalize authorized results into the existing `annunci_candidati` pipeline; preserve source URL, source, publication date and confidence; deduplicate by canonical listing identity; keep uncertain seller classifications in manual review.

## Acceptance criteria for a portal connector

- Written terms/provider permission cover the intended acquisition and commercial use.
- No login scraping, hidden endpoint probing, CAPTCHA solving, proxy rotation to evade controls or anti-bot bypass.
- Tested against sanitized, representative real email/API fixtures.
- Exact province boundary is enforced and tested.
- Seller type is backed by an explicit provider field or marked "Da verificare".
- No phone number is inferred from a "phone available" flag.
- Idempotent deduplication and source provenance are preserved.
- Failures and blocked access stop safely; no repeated retry loop against a block page.

## Official provider references

- Subito general terms: https://info.subito.it/policies/condizioni-generali.htm
- Idealista Search API access request: https://developers.idealista.com/access-request
- Immobiliare.it Insights API: https://www.immobiliare.it/insights/dati-api/
- Immobiliare.it listing feed documentation (outbound publication/synchronization): https://feed.immobiliare.it/integration/ii/docs/import/get-start
- Green-Acres feed purpose must be checked against its own current provider documentation before implementing any inbound use.
