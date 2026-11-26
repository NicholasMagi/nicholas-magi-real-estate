-- =====================================================================
-- NMRE · Fase 2 · Avvisi dubbi esclusi dal filtro (rete di sicurezza)
-- =====================================================================
-- STATO: NON APPLICATA IN PRODUZIONE. Da applicare solo dopo approvazione,
-- PRIMA di impostare NMRE_CAPTURE_DUBIOUS_ALERTS=true sulla funzione
-- nmre-gmail-scheduled (con il flag spento la funzione non usa la tabella).
-- Rollback: supabase/rollback/20261125201000_gmail_dubious_alerts.rollback.sql
-- Test:     supabase/tests/run_migration_tests.sh
--
-- Contenuto: solo il riferimento all'email originale (ID Gmail e Message-ID),
-- data di ricezione, regola del filtro che l'ha esclusa, prova che la rende
-- dubbia, portale, link della scheda e oggetto. MAI il testo del messaggio.
-- L'email resta in Gmail (accesso in sola lettura): nulla viene cancellato.
-- =====================================================================

create table if not exists public.nmre_gmail_avvisi_dubbi (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  gmail_message_id text not null check (length(gmail_message_id) between 1 and 200),
  rfc822_message_id text check (rfc822_message_id is null or length(rfc822_message_id) <= 300),
  ricevuto_il timestamptz,
  regola_esclusione text not null check (regola_esclusione in (
    'esclusione_nell_oggetto','esclusione_nel_testo','nessun_segnale_di_avviso',
    'nessun_link_annuncio','link_principale_generico')),
  prova text not null check (prova in ('scheda_specifica','mittente_portale')),
  portale text check (portale is null or length(portale) <= 80),
  link_annuncio text check (link_annuncio is null or (length(link_annuncio) <= 2000 and link_annuncio ~ '^https://')),
  oggetto text check (oggetto is null or length(oggetto) <= 300),
  stato text not null default 'da_verificare'
    check (stato in ('da_verificare','da_promuovere','promosso','ignorato')),
  candidato_id uuid,
  decisione_motivo text check (decisione_motivo is null or length(decisione_motivo) <= 300),
  deciso_il timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nmre_gmail_avvisi_dubbi_owner_message_key unique (owner_id, gmail_message_id)
);

create index if not exists nmre_gmail_avvisi_dubbi_owner_stato_idx
  on public.nmre_gmail_avvisi_dubbi (owner_id, stato, created_at desc);

alter table public.nmre_gmail_avvisi_dubbi enable row level security;

-- Supabase concede per impostazione predefinita tutti i privilegi sulle nuove
-- tabelle di public: si parte da zero e si concede solo il necessario.
revoke all on table public.nmre_gmail_avvisi_dubbi from public, anon, authenticated;
grant select on table public.nmre_gmail_avvisi_dubbi to authenticated;
-- L'utente può solo decidere: chiedere la promozione, ignorare o ripristinare.
grant update (stato, decisione_motivo, deciso_il, updated_at)
  on table public.nmre_gmail_avvisi_dubbi to authenticated;
grant all on table public.nmre_gmail_avvisi_dubbi to service_role;

drop policy if exists nmre_gmail_avvisi_dubbi_select_own on public.nmre_gmail_avvisi_dubbi;
create policy nmre_gmail_avvisi_dubbi_select_own
  on public.nmre_gmail_avvisi_dubbi for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists nmre_gmail_avvisi_dubbi_update_own on public.nmre_gmail_avvisi_dubbi;
create policy nmre_gmail_avvisi_dubbi_update_own
  on public.nmre_gmail_avvisi_dubbi for update to authenticated
  using ((select auth.uid()) = owner_id and stato <> 'promosso')
  with check ((select auth.uid()) = owner_id and stato in ('da_verificare','da_promuovere','ignorato'));

comment on table public.nmre_gmail_avvisi_dubbi is
  'Email escluse dal filtro avvisi ma con una prova di riferirsi a un annuncio. Nessun testo del messaggio. Inserimento solo dal backend (service_role).';
