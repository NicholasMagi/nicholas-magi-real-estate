-- NMRE · Scheda completa di prequalifica venditore.
-- La colonna è additiva: le schede esistenti ricevono un oggetto vuoto.
-- Nessuna policy nuova: la tabella annunci mantiene le RLS già applicate.
alter table public.annunci
  add column if not exists prequalifica jsonb not null default '{}'::jsonb;

alter table public.annunci
  drop constraint if exists annunci_prequalifica_object_check,
  add constraint annunci_prequalifica_object_check
    check (jsonb_typeof(prequalifica) = 'object');

comment on column public.annunci.prequalifica is
  'Dati strutturati della prequalifica venditore: prezzo minimo, mutuo/ipoteche, proprietà, conformità, documenti, visite, urgenza e note.';
