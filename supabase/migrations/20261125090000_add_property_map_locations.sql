-- Persist map coordinates for managed properties and archived listings.
-- Coordinates are cached by the app after a user-initiated geocoding request.

alter table public.annunci
  add column if not exists indirizzo text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_precision text,
  add column if not exists location_updated_at timestamptz;

alter table public.nmre_properties
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_precision text,
  add column if not exists location_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'annunci_map_coordinates_valid'
      and conrelid = 'public.annunci'::regclass
  ) then
    alter table public.annunci
      add constraint annunci_map_coordinates_valid
      check (
        (latitude is null and longitude is null)
        or (latitude between -90 and 90 and longitude between -180 and 180)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'nmre_properties_map_coordinates_valid'
      and conrelid = 'public.nmre_properties'::regclass
  ) then
    alter table public.nmre_properties
      add constraint nmre_properties_map_coordinates_valid
      check (
        (latitude is null and longitude is null)
        or (latitude between -90 and 90 and longitude between -180 and 180)
      );
  end if;
end $$;

create index if not exists annunci_owner_map_idx
  on public.annunci (owner_id, created_at desc);

create index if not exists nmre_properties_owner_map_idx
  on public.nmre_properties (owner_id, status, created_at desc);
