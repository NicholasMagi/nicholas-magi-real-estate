# Portal integration strategy

## Sources that can be connected directly

### Immobiliare.it Insights — documented API
The nmre-insights-sync Edge Function uses the official Comps Finder API:
- OAuth 2.0 password grant, with credentials stored only as Supabase Edge Function secrets.
- Search by attribute on active/published sale offers (comparableTypeID=1, contractTypeID=1).
- Private publisher filter (`clientTypeID=1`) and optional `phoneNumberProvided=true` search filter. This is only a portal-side availability flag: the official output mapping does not expose the seller's phone number, so imported candidates still require opening the original listing and manually verifying the contact details.
- Restricted to the configured Marche municipality allowlist after the API response.
- Up to three pages per manual sync; deduplication uses the API UUID.
- The documented output provides listing URL, title, municipality, asking price, type, gross surface, rooms and bathrooms. `phoneNumberProvided` is a request filter, not a returned phone number. NMRE stores this distinction in the seller evidence and never fills the CRM contact field from that boolean.

Required Supabase Edge Function secrets:
- INSIGHTS_CLIENT_ID
- INSIGHTS_CLIENT_SECRET
- INSIGHTS_USERNAME
- INSIGHTS_PASSWORD
- NMRE_INSIGHTS_ENV (sandbox by default; production only after provider approval and entitlement)

The account must be entitled to Comps Finder and the requested filters. A sandbox or production request must not be run until the provider has supplied the credentials. The server-side `INSIGHTS_LEAD_USE_APPROVED=true` gate must also remain disabled until the provider confirms in writing that using the results for real-estate prospecting/acquisition is permitted. Portal general terms prohibit unauthorized commercial exploitation of portal services/data; obtaining an API token alone does not establish permission for this purpose.

## Sources that require portal approval

### Idealista Search API
Idealista publicly documents the existence and purpose of Search API, but key issuance requires an access request and project description. The API contract details are not sufficiently available in the public access page to safely hard-code an endpoint, token flow or response schema. No guessed endpoint is enabled. Once the provider supplies the official integration documentation and credentials, create the adapter from that contract.

Access request: https://developers.idealista.com/access-request

## Sources with different integration purposes

- Green-Acres documents an XML feed for sending an agency's own listings to Green-Acres. It is an outbound publishing integration, not a search API for privately advertised properties.
- Subito documents authorized real-estate CRM integrations for publishing/managing professional adverts. Its terms also restrict contacting advertisers to propose intermediation services. NMRE does not scrape Subito or automate such outreach.
- Casa.it, Gate-away, Trovacasa and Wikicasa remain supported as possible Gmail alert sources when their account alerts arrive in the connected mailbox. No direct inbound public API is assumed without provider documentation or a signed data agreement.

## General collection policy
Direct imports must use provider-issued credentials, feeds or contracts. No CAPTCHA bypass, login scraping, hidden endpoint probing or bulk harvesting of personal contact details is implemented. Ambiguous sellers remain in manual review.