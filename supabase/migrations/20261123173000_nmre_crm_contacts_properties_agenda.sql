-- CRM base: contacts, property portfolio and agenda.
-- All records are tenant-scoped; composite foreign keys prevent cross-owner links.

create unique index if not exists annunci_owner_id_id_unique_idx on public.annunci(owner_id,id);

create table public.nmre_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 180),
  contact_type text not null default 'proprietario'
    check (contact_type in ('proprietario','acquirente','venditore','locatore','conduttore','investitore','professionista','altro')),
  phone text, email text, municipality text, address text, source text,
  status text not null default 'nuovo'
    check (status in ('nuovo','da_contattare','contattato','interessato','cliente','non_interessato','archiviato')),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint nmre_contacts_owner_id_id_key unique (owner_id,id)
);

create table public.nmre_properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid, source_listing_id uuid,
  title text not null check (length(trim(title)) between 3 and 220),
  municipality text not null, address text, property_type text,
  status text not null default 'da_valutare'
    check (status in ('da_valutare','acquisizione','incarico','in_vendita','proposta','venduto','locato','archiviato')),
  asking_price numeric(14,2) check (asking_price is null or asking_price >= 0),
  surface_sqm integer check (surface_sqm is null or surface_sqm between 1 and 100000),
  rooms numeric(4,1) check (rooms is null or rooms between 0.5 and 100),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint nmre_properties_owner_id_id_key unique (owner_id,id),
  constraint nmre_properties_contact_owner_fk foreign key (owner_id,contact_id) references public.nmre_contacts(owner_id,id),
  constraint nmre_properties_listing_owner_fk foreign key (owner_id,source_listing_id) references public.annunci(owner_id,id)
);

create table public.nmre_appointments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid, property_id uuid,
  title text not null check (length(trim(title)) between 2 and 180),
  appointment_type text not null default 'appuntamento'
    check (appointment_type in ('telefonata','visita','appuntamento','valutazione','follow_up','riunione','altro')),
  starts_at timestamptz not null, ends_at timestamptz,
  status text not null default 'programmato'
    check (status in ('programmato','completato','annullato')),
  location text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint nmre_appointments_contact_owner_fk foreign key (owner_id,contact_id) references public.nmre_contacts(owner_id,id),
  constraint nmre_appointments_property_owner_fk foreign key (owner_id,property_id) references public.nmre_properties(owner_id,id),
  constraint nmre_appointments_end_after_start check (ends_at is null or ends_at > starts_at),
  constraint nmre_appointments_related_record check (contact_id is not null or property_id is not null)
);

create index nmre_contacts_owner_name_idx on public.nmre_contacts(owner_id,full_name);
create index nmre_contacts_owner_status_idx on public.nmre_contacts(owner_id,status);
create index nmre_properties_owner_status_idx on public.nmre_properties(owner_id,status);
create index nmre_properties_owner_municipality_idx on public.nmre_properties(owner_id,municipality);
create index nmre_appointments_owner_starts_idx on public.nmre_appointments(owner_id,starts_at);
create index nmre_appointments_owner_status_idx on public.nmre_appointments(owner_id,status);

alter table public.nmre_contacts enable row level security;
alter table public.nmre_properties enable row level security;
alter table public.nmre_appointments enable row level security;

create policy "nmre_contacts_select_own" on public.nmre_contacts for select to authenticated using ((select auth.uid()) = owner_id);
create policy "nmre_contacts_insert_own" on public.nmre_contacts for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "nmre_contacts_update_own" on public.nmre_contacts for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "nmre_contacts_delete_own" on public.nmre_contacts for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "nmre_properties_select_own" on public.nmre_properties for select to authenticated using ((select auth.uid()) = owner_id);
create policy "nmre_properties_insert_own" on public.nmre_properties for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "nmre_properties_update_own" on public.nmre_properties for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "nmre_properties_delete_own" on public.nmre_properties for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "nmre_appointments_select_own" on public.nmre_appointments for select to authenticated using ((select auth.uid()) = owner_id);
create policy "nmre_appointments_insert_own" on public.nmre_appointments for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "nmre_appointments_update_own" on public.nmre_appointments for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "nmre_appointments_delete_own" on public.nmre_appointments for delete to authenticated using ((select auth.uid()) = owner_id);

grant select,insert,update,delete on public.nmre_contacts to authenticated;
grant select,insert,update,delete on public.nmre_properties to authenticated;
grant select,insert,update,delete on public.nmre_appointments to authenticated;
