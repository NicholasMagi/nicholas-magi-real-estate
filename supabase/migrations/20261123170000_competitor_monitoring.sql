-- NMRE Competitive Intelligence: agencies, monitored listings and price history
create table if not exists public.nmre_competitor_agencies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  municipality text not null check (length(trim(municipality)) between 2 and 100),
  website text,
  service_areas text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nmre_competitor_agencies_id_owner_unique unique (id, owner_id)
);

create unique index if not exists nmre_competitor_agencies_owner_name_town_uidx
  on public.nmre_competitor_agencies (owner_id, lower(name), lower(municipality));

create table if not exists public.nmre_competitor_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  agency_id uuid not null,
  title text not null check (length(trim(title)) between 3 and 220),
  municipality text not null check (length(trim(municipality)) between 2 and 100),
  current_price numeric(14,2) check (current_price is null or current_price > 0),
  property_type text,
  surface_mq integer check (surface_mq is null or surface_mq between 1 and 100000),
  source_url text,
  listing_status text not null default 'online' check (listing_status in ('online','offline')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nmre_competitor_listings_id_owner_unique unique (id, owner_id),
  constraint nmre_competitor_listings_agency_owner_fkey
    foreign key (agency_id, owner_id)
    references public.nmre_competitor_agencies(id, owner_id)
    on delete restrict
);

create index if not exists nmre_competitor_listings_owner_status_idx
  on public.nmre_competitor_listings (owner_id, listing_status, first_seen_at desc);
create index if not exists nmre_competitor_listings_owner_municipality_idx
  on public.nmre_competitor_listings (owner_id, lower(municipality));

create table if not exists public.nmre_competitor_price_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  listing_id uuid not null,
  price numeric(14,2) not null check (price > 0),
  source text not null default 'rilevamento manuale',
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint nmre_competitor_price_history_listing_owner_fkey
    foreign key (listing_id, owner_id)
    references public.nmre_competitor_listings(id, owner_id)
    on delete cascade
);

create index if not exists nmre_competitor_price_history_listing_time_idx
  on public.nmre_competitor_price_history (owner_id, listing_id, observed_at desc);

alter table public.nmre_competitor_agencies enable row level security;
alter table public.nmre_competitor_listings enable row level security;
alter table public.nmre_competitor_price_history enable row level security;

drop policy if exists nmre_competitor_agencies_owner_all on public.nmre_competitor_agencies;
create policy nmre_competitor_agencies_owner_all
  on public.nmre_competitor_agencies for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists nmre_competitor_listings_owner_all on public.nmre_competitor_listings;
create policy nmre_competitor_listings_owner_all
  on public.nmre_competitor_listings for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists nmre_competitor_price_history_owner_all on public.nmre_competitor_price_history;
create policy nmre_competitor_price_history_owner_all
  on public.nmre_competitor_price_history for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.nmre_competitor_agencies to authenticated;
grant select, insert, update, delete on public.nmre_competitor_listings to authenticated;
grant select, insert, update, delete on public.nmre_competitor_price_history to authenticated;
