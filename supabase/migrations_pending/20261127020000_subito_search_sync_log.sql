-- =====================================================================
-- NMRE · Registro delle sincronizzazioni delle ricerche salvate Subito
-- =====================================================================
-- STATO: NON APPLICATA IN PRODUZIONE. Da applicare solo dopo approvazione,
-- PRIMA di impostare NMRE_SUBITO_FULL_SEARCH=true sulla funzione
-- nmre-gmail-scheduled (con la variabile spenta la funzione non usa la tabella).
-- Rollback: supabase/rollback/20261127020000_subito_search_sync_log.rollback.sql
-- Test:     supabase/tests/run_migration_tests.sh
--
-- Nuova tabella, nessuna modifica a tabelle, colonne o trigger esistenti.
-- Una riga per email Subito di ricerca salvata (chiave owner_id + gmail_message_id):
-- la rielaborazione della stessa email aggiorna la stessa riga, mai un doppione.
-- Contenuto: solo conteggi, esito, motivo e riferimenti (ID degli annunci, link della
-- ricerca). MAI il testo dell'email.
-- =====================================================================

create table if not exists public.nmre_subito_ricerche_sync (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null check (length(gmail_message_id) between 1 and 200),
  ricerca_chiave text check (ricerca_chiave is null or length(ricerca_chiave) <= 1000),
  ricerca_nome text check (ricerca_nome is null or length(ricerca_nome) <= 200),
  url_ricerca text check (url_ricerca is null or (length(url_ricerca) <= 2000 and url_ricerca ~ '^https://www\.subito\.it/')),
  email_ricevuta_il timestamptz,
  eseguita_il timestamptz not null default now(),
  esito text not null check (esito in ('completa','parziale','errore','assorbita')),
  motivo text not null check (length(motivo) between 1 and 80),
  motivo_testo text check (motivo_testo is null or length(motivo_testo) <= 300),
  pagine_lette integer not null default 0 check (pagine_lette >= 0),
  pagine_dichiarate integer check (pagine_dichiarate is null or pagine_dichiarate >= 0),
  annunci_dichiarati_ricerca integer check (annunci_dichiarati_ricerca is null or annunci_dichiarati_ricerca >= 0),
  annunci_trovati integer not null default 0 check (annunci_trovati >= 0),
  nuove_opportunita integer not null default 0 check (nuove_opportunita >= 0),
  gia_in_opportunita integer not null default 0 check (gia_in_opportunita >= 0),
  gia_in_archivio integer not null default 0 check (gia_in_archivio >= 0),
  da_verificare integer not null default 0 check (da_verificare >= 0),
  professionali integer not null default 0 check (professionali >= 0),
  possibili_duplicati integer not null default 0 check (possibili_duplicati >= 0),
  duplicati_da_unificare integer not null default 0 check (duplicati_da_unificare >= 0),
  notifica_raggruppata boolean not null default false,
  tentativi integer not null default 0 check (tentativi >= 0),
  nuovo_tentativo boolean not null default false,
  dettagli jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nmre_subito_ricerche_sync_owner_message_key unique (owner_id, gmail_message_id)
);

create index if not exists nmre_subito_ricerche_sync_owner_eseguita_idx
  on public.nmre_subito_ricerche_sync (owner_id, eseguita_il desc);

alter table public.nmre_subito_ricerche_sync enable row level security;

-- Si parte da zero: l'app legge soltanto, scrive solo il backend (service_role).
revoke all on table public.nmre_subito_ricerche_sync from public, anon, authenticated;
grant select on table public.nmre_subito_ricerche_sync to authenticated;
grant all on table public.nmre_subito_ricerche_sync to service_role;

drop policy if exists nmre_subito_ricerche_sync_select_own on public.nmre_subito_ricerche_sync;
create policy nmre_subito_ricerche_sync_select_own
  on public.nmre_subito_ricerche_sync for select to authenticated
  using ((select auth.uid()) = owner_id);

comment on table public.nmre_subito_ricerche_sync is
  'Registro delle sincronizzazioni delle ricerche salvate Subito (una riga per email). Solo conteggi e riferimenti, nessun testo delle email. Scrittura solo dal backend.';

notify pgrst, 'reload schema';
