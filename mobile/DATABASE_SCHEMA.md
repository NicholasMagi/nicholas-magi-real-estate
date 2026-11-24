# NMRE Mobile — Database schema inventory

## 1. Verified environment and drift
Live Supabase ref: `hhircfmrtkgaybrougku`; PostgreSQL 17; EU West 1. This is production and must remain read-only during initial mobile work.
Live database lists 33 applied migration records; repository currently has 7 migration files. This migration-history drift means the repo migrations cannot be assumed to recreate production. Reconcile separately before schema deployments.

All 19 public application tables inspected have RLS enabled and owner-scoped policies using auth.uid(). Private schema is not a mobile data API.

## 2. Public tables

### Acquisition
- `annunci`: managed listings and CRM state. Relevant: id, owner_id, titolo, comune, prezzo, contatto, tipo_venditore, portale, url, data_pubblicazione, created_at, note_personali, stato_contatto, prossimo_contatto_il, ultimo_contatto_il, tipologia_immobile, superficie_mq, locali, camere, bagni, vendita_motivazione, tempistiche_vendita, altre_agenzie, prezzo_trattabile, source_candidate_id, seller_identity/confidence/evidence/manual_override, listing_key and source/extraction JSON.
- `annunci_candidati`: inbound candidates with title, town, price, seller type, URL, email/source identifiers, dedup_key, review state, linked archived listing, property details and classification/extraction versions.
- `annunci_candidati_notifiche`: candidate notification observations: candidate_id, source_email_id, notified_at, listing_url, listing_price, previous_price, price_drop_amount/percent and listing attributes.
- `annunci_interazioni`: listing interactions, outcome, notes, follow-up date and outcome code.
- `seller_identity_registry`: normalized verified seller identity/phone/email evidence; sensitive data.

### CRM
- `nmre_contacts`: full_name, contact_type, phone, email, municipality, address, source, status, notes.
- `nmre_properties`: contact_id, source_listing_id, title, municipality, address, property_type, status, asking_price, surface_sqm, rooms, notes.
- `nmre_contact_interactions`: contact/property interactions, outcome, notes, next_contact_at.
- `nmre_appointments`: contact/property, title, appointment_type, starts_at/ends_at, status, location, notes.
- `nmre_sales_goals`: owner-scoped daily/weekly activity targets.

### Market / competition
- `nmre_competitor_agencies`: monitored agencies and service areas.
- `nmre_competitor_listings`: tracked competitor properties and price/status/source.
- `nmre_competitor_price_history`: price observations with source and observed_at.
- `nmre_omi_quotazioni`: OMI semester, municipality/zone, type/condition, purchase/rent ranges and source/license.
- `nmre_compravendite_atti`: declared deed-level observations. An amount may cover multiple properties; property-level €/m² is valid only when current attribution and verification fields permit it.

### Sync / notification
- `nmre_gmail_sync_runs`: sync status, mode, counts, duration, errors and timestamps.
- `nmre_notifications`: owner-scoped in-app notifications and read/archive/push state.
- `nmre_notification_preferences`: global/category settings and quiet hours.
- `nmre_push_subscriptions`: browser Web Push/VAPID only, not native tokens.

## 3. Private schema
Observed tables: `gmail_oauth_states`, `gmail_oauth_tokens`, `gmail_push_watch_state`, `gmail_sync_lock`, `gmail_sync_state`. These hold OAuth state, encrypted tokens, sync cursors and locks. Not available directly to mobile. Inspected anon/authenticated SELECT privileges were false. Two private tables have RLS disabled but client grants revoked; resolve advisor finding through a deliberate service-only review, not by granting client access.

## 4. Relations and domain view models
Observed relations include listing interactions → listing; candidate → promoted listing; archived listing → source candidate; candidate notification → candidate; competitor snapshot → competitor listing; CRM property → contact/source listing; appointment and contact interaction → contact/property.
Regenerate exact FK/index catalog and generated TS types before coding; this document is not a live DDL export.

Feature view models:
- ListingSummary: id/title/municipality/price/type/surface/sellerClass/status/createdAt/source URL.
- CandidateSummary: id/title/municipality/price/sellerClass/confidence/evidence/review status/observedAt.
- ListingDetail: summary + qualification + interactions.
- PriceObservation: source/price/previousPrice/delta/observedAt/source reference.
- ContactSummary, PropertySummary, AppointmentSummary with only required fields.
Preserve seller evidence/manual override and source provenance. Privately classified candidate is not necessarily a mandate.

## 5. Query rules
Use 25–50 row pagination, deterministic order (created_at DESC, id ASC), narrow select lists and server-side filtering. Debounce text queries. Do not load all records at once. Check EXPLAIN before adding indexes. Supabase advisor listed 25 unused indexes; low traffic is not evidence to delete them.

## 6. Proposed favorites migration (NOT deployed)
Proposed table `public.nmre_favorites`:
- id UUID PK
- owner_id UUID NOT NULL references auth.users(id) ON DELETE CASCADE
- annuncio_id UUID NOT NULL references public.annunci(id) ON DELETE CASCADE
- created_at timestamptz NOT NULL DEFAULT now()
- UNIQUE(owner_id, annuncio_id)

Enable RLS. SELECT/DELETE only own owner_id; INSERT WITH CHECK owner_id=auth.uid(); no UPDATE needed. Grant authenticated only required operations. Index owner_id/created_at DESC. Ensure referenced listing belongs to same owner through tested policy/trigger. This table does not exist yet and must not be used until an approved additive migration is applied to staging.

## 7. Proposed native push registry (NOT deployed)
Do not reuse `nmre_push_subscriptions`. Native push requires a separate owner-scoped APNs/FCM/Expo device-token registry and server-side dispatcher; tokens rotate/revoke and provider secrets stay server-side.

## 8. Before any schema change
Export live schema/policies; reconcile migration history; create isolated staging with synthetic/anonymized data; write additive migration and rollback; test as anon, owner A, owner B and service_role; run advisors/integration tests; obtain explicit approval before production deployment.
