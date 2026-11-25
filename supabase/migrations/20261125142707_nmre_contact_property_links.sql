create table public.nmre_property_contacts (
  owner_id uuid not null default auth.uid(),
  property_id uuid not null,
  contact_id uuid not null,
  relation_role text not null default 'proprietario',
  created_at timestamptz not null default now(),
  constraint nmre_property_contacts_pkey primary key (owner_id, property_id, contact_id),
  constraint nmre_property_contacts_role_check check (
    relation_role = any (array['proprietario','comproprietario','referente','familiare','altro']::text[])
  ),
  constraint nmre_property_contacts_owner_fkey foreign key (owner_id)
    references auth.users(id) on delete cascade,
  constraint nmre_property_contacts_property_owner_fkey foreign key (owner_id, property_id)
    references public.nmre_properties(owner_id, id) on delete cascade,
  constraint nmre_property_contacts_contact_owner_fkey foreign key (owner_id, contact_id)
    references public.nmre_contacts(owner_id, id) on delete cascade
);
create index nmre_property_contacts_owner_contact_idx
  on public.nmre_property_contacts(owner_id, contact_id, created_at desc);
create index nmre_property_contacts_owner_property_idx
  on public.nmre_property_contacts(owner_id, property_id);
alter table public.nmre_property_contacts enable row level security;
revoke all on table public.nmre_property_contacts from anon;
grant select, insert, update, delete on table public.nmre_property_contacts to authenticated;
create policy nmre_property_contacts_select_own
  on public.nmre_property_contacts for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy nmre_property_contacts_insert_own
  on public.nmre_property_contacts for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy nmre_property_contacts_update_own
  on public.nmre_property_contacts for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy nmre_property_contacts_delete_own
  on public.nmre_property_contacts for delete to authenticated
  using ((select auth.uid()) = owner_id);
insert into public.nmre_property_contacts(owner_id, property_id, contact_id, relation_role, created_at)
select owner_id, id, contact_id, 'proprietario', created_at
from public.nmre_properties
where contact_id is not null
on conflict (owner_id, property_id, contact_id) do nothing;
