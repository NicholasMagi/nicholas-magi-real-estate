alter table public.annunci
  add column if not exists vendita_motivazione text,
  add column if not exists tempistiche_vendita text,
  add column if not exists altre_agenzie text not null default 'da_verificare',
  add column if not exists prezzo_trattabile text not null default 'da_verificare';

alter table public.annunci
  drop constraint if exists annunci_altre_agenzie_check,
  add constraint annunci_altre_agenzie_check
    check (altre_agenzie in ('nessuna','non_esclusiva','esclusiva','in_trattativa','da_verificare')),
  drop constraint if exists annunci_prezzo_trattabile_check,
  add constraint annunci_prezzo_trattabile_check
    check (prezzo_trattabile in ('si','parzialmente','no','da_verificare')),
  drop constraint if exists annunci_tempistiche_vendita_check,
  add constraint annunci_tempistiche_vendita_check
    check (tempistiche_vendita is null or tempistiche_vendita in ('entro_30_giorni','1_3_mesi','3_6_mesi','oltre_6_mesi','senza_fretta','da_chiarire'));

create index if not exists annunci_owner_qualification_idx
  on public.annunci (owner_id, altre_agenzie, prezzo_trattabile, tempistiche_vendita);