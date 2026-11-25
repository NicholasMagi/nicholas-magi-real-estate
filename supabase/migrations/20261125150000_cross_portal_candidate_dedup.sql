-- Add review metadata for candidate listings that may describe the same property.
-- Additive only: no existing candidate records are merged, deleted or modified.
alter table public.annunci_candidati
  add column if not exists possible_duplicate_of uuid,
  add column if not exists possible_duplicate_confidence smallint,
  add column if not exists possible_duplicate_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='annunci_candidati_possible_duplicate_of_fkey' and conrelid='public.annunci_candidati'::regclass) then
    alter table public.annunci_candidati add constraint annunci_candidati_possible_duplicate_of_fkey
      foreign key (possible_duplicate_of) references public.annunci_candidati(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='annunci_candidati_possible_duplicate_confidence_check' and conrelid='public.annunci_candidati'::regclass) then
    alter table public.annunci_candidati add constraint annunci_candidati_possible_duplicate_confidence_check
      check (possible_duplicate_confidence is null or possible_duplicate_confidence between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname='annunci_candidati_possible_duplicate_reason_check' and conrelid='public.annunci_candidati'::regclass) then
    alter table public.annunci_candidati add constraint annunci_candidati_possible_duplicate_reason_check
      check (possible_duplicate_reason is null or length(possible_duplicate_reason)<=500);
  end if;
end;
$$;
create index if not exists annunci_candidati_owner_possible_duplicate_idx
  on public.annunci_candidati(owner_id,possible_duplicate_of)
  where possible_duplicate_of is not null;
comment on column public.annunci_candidati.possible_duplicate_of is 'Candidate that may describe the same property; review pointer only, never an automatic merge by itself.';
comment on column public.annunci_candidati.possible_duplicate_confidence is 'Heuristic matching score 0-100; not a probability.';
comment on column public.annunci_candidati.possible_duplicate_reason is 'Human-readable explanation; excludes raw email content.';
