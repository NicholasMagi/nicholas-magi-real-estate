alter table public.annunci_interazioni
  add column if not exists outcome_code text;

do $$
begin
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
end $$;

create index if not exists annunci_interazioni_owner_outcome_created_idx
  on public.annunci_interazioni (owner_id, outcome_code, created_at desc);