-- Cover composite foreign keys used by competitor monitoring tables.
-- Keep tenant ownership as the second key component to match the FK definition.

create index if not exists nmre_competitor_listings_agency_owner_idx
  on public.nmre_competitor_listings (agency_id, owner_id);

create index if not exists nmre_competitor_price_history_listing_owner_idx
  on public.nmre_competitor_price_history (listing_id, owner_id);
