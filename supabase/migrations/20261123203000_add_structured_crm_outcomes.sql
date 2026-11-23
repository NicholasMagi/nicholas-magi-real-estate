-- Structured commercial outcomes for CRM interactions.
-- Optional property linkage keeps each event tied to a property owned by the same user.

alter table public.nmre_contact_interactions
  add column if not exists outcome_code text,
  add column if not exists property_id uuid;

alter table public.annunci_interazioni
  add column if not exists outcome_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'nmre_contact_interactions_outcome_code_check'
      and conrelid = 'public.nmre_contact_interactions'::regclass
  ) then
    alter table public.nmre_contact_interactions
      add constraint nmre_contact_interactions_outcome_code_check
      check (outcome_code is null or outcome_code = any (array[
        'nessuna_risposta',
        'parlato',
        'richiamare',
        'interessato',
        'appuntamento_fissato',
        'valutazione_fissata',
        'valutazione_completata',
        'incarico_acquisito',
        'non_interessato'
      ]));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'annunci_interazioni_outcome_code_check'
      and conrelid = 'public.annunci_interazioni'::regclass
  ) then
    alter table public.annunci_interazioni
      add constraint annunci_interazioni_outcome_code_check
      check (outcome_code is null or outcome_code = any (array[
        'nessuna_risposta',
        'parlato',
        'richiamare',
        'interessato',
        'appuntamento_fissato',
        'valutazione_fissata',
        'valutazione_completata',
        'incarico_acquisito',
        'non_interessato',
        'numero_errato',
        'altro'
      ]));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'nmre_contact_interactions_property_owner_fk'
      and conrelid = 'public.nmre_contact_interactions'::regclass
  ) then
    alter table public.nmre_contact_interactions
      add constraint nmre_contact_interactions_property_owner_fk
      foreign key (owner_id, property_id)
      references public.nmre_properties(owner_id, id);
  end if;
end $$;

create index if not exists nmre_contact_interactions_owner_created_idx
  on public.nmre_contact_interactions (owner_id, created_at desc);

create index if not exists nmre_contact_interactions_owner_outcome_created_idx
  on public.nmre_contact_interactions (owner_id, outcome_code, created_at desc);

create index if not exists nmre_contact_interactions_owner_property_idx
  on public.nmre_contact_interactions (owner_id, property_id);
