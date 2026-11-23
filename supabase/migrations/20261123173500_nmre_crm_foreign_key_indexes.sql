-- Cover CRM foreign keys to keep contact/property lookups efficient.
create index if not exists nmre_properties_owner_contact_idx on public.nmre_properties(owner_id,contact_id);
create index if not exists nmre_properties_owner_source_listing_idx on public.nmre_properties(owner_id,source_listing_id);
create index if not exists nmre_appointments_owner_contact_idx on public.nmre_appointments(owner_id,contact_id);
create index if not exists nmre_appointments_owner_property_idx on public.nmre_appointments(owner_id,property_id);
