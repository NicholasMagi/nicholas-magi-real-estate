#!/usr/bin/env bash
# Test delle migrazioni NMRE su un database PostgreSQL LOCALE e usa e getta.
#
# Uso:  PGHOST=/percorso/socket PGPORT=54329 PGUSER=postgres supabase/tests/run_migration_tests.sh
#
# Lo script crea un database temporaneo con uno schema minimo che imita quello di
# produzione (stub di auth, ruoli Supabase, tabella annunci_candidati, trigger di
# notifica), applica migrazioni e rollback e verifica il comportamento.
# NON va mai eseguito contro la produzione: si rifiuta se PGHOST punta a Supabase.
set -euo pipefail

if [[ "${PGHOST:-}" == *supabase* || "${DATABASE_URL:-}" == *supabase* ]]; then
  echo "Rifiutato: questo test va eseguito solo su un database locale usa e getta." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GUARD="$ROOT/supabase/migrations/20261125200000_guard_agency_candidate_notifications.sql"
GUARD_RB="$ROOT/supabase/rollback/20261125200000_guard_agency_candidate_notifications.rollback.sql"
DUBIOUS="$ROOT/supabase/migrations/20261125201000_gmail_dubious_alerts.sql"
PRICE="$ROOT/supabase/migrations/20261125202000_guard_agency_price_drop_notifications.sql"
PRICE_RB="$ROOT/supabase/rollback/20261125202000_guard_agency_price_drop_notifications.rollback.sql"
DUBIOUS_RB="$ROOT/supabase/rollback/20261125201000_gmail_dubious_alerts.rollback.sql"
DB="nmre_migration_test_$$"

psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
pass() { echo "ok   $1"; }

cleanup() { psql -X -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

base_schema() {
  psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
  psql_db <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth; create schema private;
grant usage on schema auth, public to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
grant execute on function auth.uid() to anon, authenticated, service_role;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

create table public.annunci_candidati (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  stato text not null,
  tipo_venditore text
);
create table public.nmre_notifications (
  id bigint generated always as identity primary key,
  owner_id uuid, category text, candidate_id uuid
);
-- Stub che riproduce il comportamento osservato in produzione (AQ12):
-- una notifica new_opportunities per ogni candidato da_verificare.
create function private.nmre_notify_candidate_insert() returns trigger language plpgsql as $f$
begin
  if new.stato = 'da_verificare' then
    insert into public.nmre_notifications (owner_id, category, candidate_id)
    values (new.owner_id, 'new_opportunities', new.id);
  end if;
  return new;
end $f$;
create trigger nmre_notify_candidate_insert after insert on public.annunci_candidati
  for each row execute function private.nmre_notify_candidate_insert();

-- Storico notifiche e stub del secondo percorso push osservato in produzione:
-- una notifica price_drop per ogni riga dello storico che riporta un ribasso.
create table public.annunci_candidati_notifiche (
  id bigint generated always as identity primary key,
  owner_id uuid not null,
  candidate_id uuid not null,
  source_email_id text not null,
  listing_price numeric,
  previous_price numeric,
  price_drop_percent numeric,
  unique (owner_id, source_email_id)
);
create function private.nmre_notify_price_drop() returns trigger language plpgsql as $f$
begin
  if coalesce(new.price_drop_percent, 0) > 0 then
    insert into public.nmre_notifications (owner_id, category, candidate_id)
    values (new.owner_id, 'price_drop', new.candidate_id);
  end if;
  return new;
end $f$;
SQL
  if [[ "${PRICE_TRIGGER_VARIANT:-with_when}" == "with_when" ]]; then
    psql_db -c "create trigger nmre_notify_price_drop after insert or update on public.annunci_candidati_notifiche for each row when (new.price_drop_percent is not null) execute function private.nmre_notify_price_drop();"
  else
    psql_db -c "create trigger nmre_notify_price_drop after insert on public.annunci_candidati_notifiche for each row execute function private.nmre_notify_price_drop();"
  fi
}

# Simula l'ordine della sincronizzazione: prima il candidato, poi la riga dello
# storico con ribasso. Restituisce "nuove_opportunita price_drop righe_storico ribasso_salvato".
sync_with_price_drop() { # tipo_venditore email_id
  psql_db -At <<SQL
insert into public.annunci_candidati (owner_id, stato, tipo_venditore)
values ('00000000-0000-0000-0000-00000000000a', 'da_verificare', $1) returning id \gset
insert into public.annunci_candidati_notifiche (owner_id, candidate_id, source_email_id, listing_price, previous_price, price_drop_percent)
values ('00000000-0000-0000-0000-00000000000a', :'id', '$2', 95000, 100000, 5);
select (select count(*) from public.nmre_notifications where candidate_id = :'id' and category = 'new_opportunities')
  || ' ' || (select count(*) from public.nmre_notifications where candidate_id = :'id' and category = 'price_drop')
  || ' ' || (select count(*) from public.annunci_candidati_notifiche where candidate_id = :'id')
  || ' ' || (select coalesce(max(price_drop_percent)::text, 'null') from public.annunci_candidati_notifiche where candidate_id = :'id');
SQL
}
# Upsert su una riga esistente (percorso UPDATE): restituisce il numero di push price_drop del candidato.
update_existing_drop() { # tipo_venditore email_id
  psql_db -At <<SQL
insert into public.annunci_candidati (owner_id, stato, tipo_venditore)
values ('00000000-0000-0000-0000-00000000000a', 'scartato', $1) returning id \gset
insert into public.annunci_candidati_notifiche (owner_id, candidate_id, source_email_id, listing_price)
values ('00000000-0000-0000-0000-00000000000a', :'id', '$2', 100000);
insert into public.annunci_candidati_notifiche (owner_id, candidate_id, source_email_id, listing_price, previous_price, price_drop_percent)
values ('00000000-0000-0000-0000-00000000000a', :'id', '$2', 90000, 100000, 10)
on conflict (owner_id, source_email_id) do update set listing_price = excluded.listing_price,
  previous_price = excluded.previous_price, price_drop_percent = excluded.price_drop_percent;
select count(*) from public.nmre_notifications where candidate_id = :'id' and category = 'price_drop';
SQL
}

count_notifications_for() { # tipo_venditore stato -> numero di notifiche create da un inserimento
  # Due istruzioni distinte: le righe scritte da un trigger AFTER non sono visibili
  # alla stessa istruzione che ha eseguito l'inserimento.
  psql_db -At <<SQL
insert into public.annunci_candidati (owner_id, stato, tipo_venditore)
values ('00000000-0000-0000-0000-00000000000a', '$2', $1) returning id \gset
select count(*) from public.nmre_notifications where candidate_id = :'id';
SQL
}
expect() { # descrizione valore_atteso valore_ottenuto
  if [[ "$2" != "$3" ]]; then echo "FAIL $1: atteso $2, ottenuto $3" >&2; exit 1; fi
  pass "$1"
}

echo "== Trigger delle notifiche: situazione attuale (riproduce il problema)"
base_schema
expect "prima della migrazione un'agenzia genera una notifica" 1 "$(count_notifications_for "'Agenzia'" da_verificare | tail -1)"
ORIGINAL_DEF="$(psql_db -At -c "select pg_get_triggerdef(oid) from pg_trigger where tgname='nmre_notify_candidate_insert'")"

echo "== Migrazione applicata"
psql_db -f "$GUARD" >/dev/null 2>&1
expect "agenzia da verificare: nessuna notifica" 0 "$(count_notifications_for "'Agenzia'" da_verificare | tail -1)"
expect "da verificare: notifica invariata" 1 "$(count_notifications_for "'Da verificare'" da_verificare | tail -1)"
expect "privato: notifica invariata" 1 "$(count_notifications_for "'Privato'" da_verificare | tail -1)"
expect "tipo assente (NULL): notifica invariata" 1 "$(count_notifications_for "null" da_verificare | tail -1)"
expect "candidato scartato: nessuna notifica (logica della funzione invariata)" 0 "$(count_notifications_for "'Da verificare'" scartato | tail -1)"
expect "definizione originale salvata nel backup" "$ORIGINAL_DEF" "$(psql_db -At -c "select original_definition from private.nmre_trigger_definition_backups")"
expect "un solo trigger dopo la migrazione" 1 "$(psql_db -At -c "select count(*) from pg_trigger where tgrelid='public.annunci_candidati'::regclass and not tgisinternal")"

echo "== Migrazione rieseguita (idempotenza)"
psql_db -f "$GUARD" >/dev/null 2>&1
expect "agenzia ancora senza notifica" 0 "$(count_notifications_for "'Agenzia'" da_verificare | tail -1)"
expect "backup non duplicato" 1 "$(psql_db -At -c "select count(*) from private.nmre_trigger_definition_backups")"

echo "== Rollback"
psql_db -f "$GUARD_RB" >/dev/null 2>&1
expect "definizione ripristinata identica all'originale" "$ORIGINAL_DEF" "$(psql_db -At -c "select pg_get_triggerdef(oid) from pg_trigger where tgname='nmre_notify_candidate_insert'")"
expect "dopo il rollback l'agenzia genera di nuovo la notifica" 1 "$(count_notifications_for "'Agenzia'" da_verificare | tail -1)"
psql_db -f "$GUARD" >/dev/null 2>&1
expect "riapplicazione dopo il rollback" 0 "$(count_notifications_for "'Agenzia'" da_verificare | tail -1)"
psql -X -q -d postgres -c "drop database $DB" >/dev/null

echo "== Trigger disattivato: lo stato viene conservato"
base_schema
psql_db -c "alter table public.annunci_candidati disable trigger nmre_notify_candidate_insert"
psql_db -f "$GUARD" >/dev/null 2>&1
expect "trigger ancora disattivato" D "$(psql_db -At -c "select tgenabled from pg_trigger where tgname='nmre_notify_candidate_insert'")"
psql -X -q -d postgres -c "drop database $DB" >/dev/null

echo "== Forma inattesa: la migrazione si interrompe senza modifiche"
base_schema
psql_db -c "drop trigger nmre_notify_candidate_insert on public.annunci_candidati; create trigger nmre_notify_candidate_insert before insert on public.annunci_candidati for each row execute function private.nmre_notify_candidate_insert();"
BEFORE_DEF="$(psql_db -At -c "select pg_get_triggerdef(oid) from pg_trigger where tgname='nmre_notify_candidate_insert'")"
if psql_db -f "$GUARD" >/dev/null 2>&1; then echo "FAIL la migrazione doveva fermarsi" >&2; exit 1; fi
expect "trigger BEFORE lasciato intatto" "$BEFORE_DEF" "$(psql_db -At -c "select pg_get_triggerdef(oid) from pg_trigger where tgname='nmre_notify_candidate_insert'")"
expect "nessun backup scritto" 0 "$(psql_db -At -c "select count(*) from private.nmre_trigger_definition_backups" 2>/dev/null || echo 0)"
psql -X -q -d postgres -c "drop database $DB" >/dev/null

for variant in with_when without_when; do
  export PRICE_TRIGGER_VARIANT=$variant
  echo "== Push di ribasso (trigger $variant): situazione attuale"
  base_schema
  expect "[$variant] prima: un'agenzia genera new_opportunities e price_drop; storico salvato" "1 1 1 5" "$(sync_with_price_drop "'Agenzia'" e0 | tail -1)"
  PRICE_ORIGINAL_DEF="$(psql_db -At -c "select pg_get_triggerdef(oid) from pg_trigger where tgname='nmre_notify_price_drop'")"

  echo "== Push di ribasso (trigger $variant): entrambe le migrazioni applicate"
  psql_db -f "$GUARD" >/dev/null 2>&1
  psql_db -f "$PRICE" >/dev/null 2>&1
  expect "[$variant] agenzia: nessuna new_opportunities, nessuna price_drop, storico e ribasso conservati" "0 0 1 5" "$(sync_with_price_drop "'Agenzia'" e1 | tail -1)"
  expect "[$variant] privato: new_opportunities e price_drop invariate" "1 1 1 5" "$(sync_with_price_drop "'Privato'" e2 | tail -1)"
  expect "[$variant] da verificare: new_opportunities e price_drop invariate" "1 1 1 5" "$(sync_with_price_drop "'Da verificare'" e3 | tail -1)"
  expect "[$variant] tipo assente (NULL): notifiche invariate" "1 1 1 5" "$(sync_with_price_drop "null" e4 | tail -1)"
  if [[ "$variant" == "with_when" ]]; then
    expect "[$variant] percorso UPDATE (upsert): agenzia senza price_drop" 0 "$(update_existing_drop "'Agenzia'" e5 | tail -1)"
    expect "[$variant] percorso UPDATE (upsert): privato con price_drop" 1 "$(update_existing_drop "'Privato'" e6 | tail -1)"
    expect "[$variant] condizione originale conservata nella nuova definizione" 1 "$(psql_db -At -c "select count(*) from pg_trigger where tgname='nmre_notify_price_drop' and pg_get_triggerdef(oid) like '%price_drop_percent IS NOT NULL%' and pg_get_triggerdef(oid) like '%nmre_candidate_is_agency%'")"
  fi
  expect "[$variant] backup identico alla definizione originale" "$PRICE_ORIGINAL_DEF" "$(psql_db -At -c "select original_definition from private.nmre_trigger_definition_backups where table_name='public.annunci_candidati_notifiche'")"

  echo "== Push di ribasso (trigger $variant): idempotenza e rollback"
  psql_db -f "$PRICE" >/dev/null 2>&1
  expect "[$variant] seconda esecuzione: backup non duplicato" 1 "$(psql_db -At -c "select count(*) from private.nmre_trigger_definition_backups where table_name='public.annunci_candidati_notifiche'")"
  expect "[$variant] seconda esecuzione: agenzia ancora senza price_drop" "0 0 1 5" "$(sync_with_price_drop "'Agenzia'" e7 | tail -1)"
  psql_db -f "$PRICE_RB" >/dev/null 2>&1
  expect "[$variant] rollback: definizione identica all'originale" "$PRICE_ORIGINAL_DEF" "$(psql_db -At -c "select pg_get_triggerdef(oid) from pg_trigger where tgname='nmre_notify_price_drop'")"
  expect "[$variant] rollback: funzione di supporto rimossa" 0 "$(psql_db -At -c "select count(*) from pg_proc where proname='nmre_candidate_is_agency'")"
  expect "[$variant] rollback: l'agenzia genera di nuovo price_drop (new_opportunities resta protetta)" "0 1 1 5" "$(sync_with_price_drop "'Agenzia'" e8 | tail -1)"
  psql_db -f "$PRICE" >/dev/null 2>&1
  expect "[$variant] riapplicazione dopo il rollback" "0 0 1 5" "$(sync_with_price_drop "'Agenzia'" e9 | tail -1)"
  # Una riga per ogni email usata: e0–e9, esclusi e5/e6 nella variante senza percorso UPDATE.
  expected_rows=$([[ "$variant" == "with_when" ]] && echo 10 || echo 8)
  expect "[$variant] nessuna riga dello storico persa" "$expected_rows" "$(psql_db -At -c "select count(*) from public.annunci_candidati_notifiche")"
  psql -X -q -d postgres -c "drop database $DB" >/dev/null
done
unset PRICE_TRIGGER_VARIANT

echo "== Push di ribasso: forme inattese, la migrazione si interrompe senza modifiche"
base_schema
psql_db -c "drop trigger nmre_notify_price_drop on public.annunci_candidati_notifiche; create trigger nmre_notify_price_drop after insert on public.annunci_candidati_notifiche for each statement execute function private.nmre_notify_price_drop();"
if psql_db -f "$PRICE" >/dev/null 2>&1; then echo "FAIL la migrazione doveva fermarsi (trigger per istruzione)" >&2; exit 1; fi
expect "trigger per istruzione lasciato intatto, nessuna funzione di supporto" 0 "$(psql_db -At -c "select count(*) from pg_proc where proname='nmre_candidate_is_agency'")"
psql_db -c "drop trigger nmre_notify_price_drop on public.annunci_candidati_notifiche"
if psql_db -f "$PRICE" >/dev/null 2>&1; then echo "FAIL la migrazione doveva fermarsi (nessun trigger)" >&2; exit 1; fi
pass "nessun trigger di notifica: migrazione interrotta"
psql -X -q -d postgres -c "drop database $DB" >/dev/null

echo "== Avvisi dubbi: RLS e permessi"
base_schema
psql_db -f "$DUBIOUS" >/dev/null 2>&1
psql_db -f "$DUBIOUS" >/dev/null 2>&1   # idempotenza
psql_db <<'SQL' >/dev/null
insert into public.nmre_gmail_avvisi_dubbi (owner_id, gmail_message_id, regola_esclusione, prova, portale, link_annuncio, oggetto)
values ('00000000-0000-0000-0000-00000000000a','m-a','esclusione_nel_testo','scheda_specifica','immobiliare.it','https://www.immobiliare.it/annunci/1234567/','Oggetto A'),
       ('00000000-0000-0000-0000-00000000000b','m-b','nessun_segnale_di_avviso','mittente_portale','casa.it',null,'Oggetto B');
SQL
as_user() { # utente sql
  psql_db -At <<SQL 2>&1 | tail -1
set role authenticated; select set_config('request.jwt.claim.sub', '$1', false);
$2
SQL
}
A=00000000-0000-0000-0000-00000000000a
expect "l'utente vede solo i propri avvisi" 1 "$(as_user $A "select count(*) from public.nmre_gmail_avvisi_dubbi;")"
expect "l'utente può chiedere la promozione" 1 "$(as_user $A "with u as (update public.nmre_gmail_avvisi_dubbi set stato='da_promuovere', deciso_il=now(), updated_at=now() where gmail_message_id='m-a' returning 1) select count(*) from u;")"
expect "l'utente non può segnare 'promosso'" 1 "$(psql_db <<SQL 2>&1 | grep -c 'violates row-level security' || true
set role authenticated; select set_config('request.jwt.claim.sub', '$A', false);
update public.nmre_gmail_avvisi_dubbi set stato='promosso' where gmail_message_id='m-a';
SQL
)"
expect "l'utente non può modificare il riferimento all'email" 1 "$(psql_db <<SQL 2>&1 | grep -c 'permission denied' || true
set role authenticated; select set_config('request.jwt.claim.sub', '$A', false);
update public.nmre_gmail_avvisi_dubbi set gmail_message_id='altro' where gmail_message_id='m-a';
SQL
)"
expect "l'utente non può modificare gli avvisi di un altro utente" 0 "$(as_user $A "with u as (update public.nmre_gmail_avvisi_dubbi set stato='ignorato' where gmail_message_id='m-b' returning 1) select count(*) from u;")"
expect "l'utente non può inserire avvisi" 1 "$(psql_db <<SQL 2>&1 | grep -c 'permission denied' || true
set role authenticated; select set_config('request.jwt.claim.sub', '$A', false);
insert into public.nmre_gmail_avvisi_dubbi (gmail_message_id, regola_esclusione, prova) values ('x','esclusione_nel_testo','scheda_specifica');
SQL
)"
expect "l'utente non può cancellare avvisi" 1 "$(psql_db <<SQL 2>&1 | grep -c 'permission denied' || true
set role authenticated; select set_config('request.jwt.claim.sub', '$A', false);
delete from public.nmre_gmail_avvisi_dubbi;
SQL
)"
expect "anon non legge nulla" 1 "$(psql_db <<SQL 2>&1 | grep -c 'permission denied' || true
set role anon; select count(*) from public.nmre_gmail_avvisi_dubbi;
SQL
)"
expect "link non https rifiutato dal vincolo" 1 "$(psql_db -c "insert into public.nmre_gmail_avvisi_dubbi (owner_id, gmail_message_id, regola_esclusione, prova, link_annuncio) values ('$A','m-c','esclusione_nel_testo','scheda_specifica','javascript:alert(1)')" 2>&1 | grep -c 'violates check constraint' || true)"
expect "un'email registrata una sola volta per utente" 1 "$(psql_db -c "insert into public.nmre_gmail_avvisi_dubbi (owner_id, gmail_message_id, regola_esclusione, prova) values ('$A','m-a','esclusione_nel_testo','scheda_specifica')" 2>&1 | grep -c 'duplicate key' || true)"
psql_db -f "$DUBIOUS_RB" >/dev/null 2>&1
expect "rollback: l'app non legge più la tabella" 1 "$(psql_db <<SQL 2>&1 | grep -c 'permission denied' || true
set role authenticated; select set_config('request.jwt.claim.sub', '$A', false);
select count(*) from public.nmre_gmail_avvisi_dubbi;
SQL
)"
expect "rollback: i dati raccolti restano" 2 "$(psql_db -At -c "select count(*) from public.nmre_gmail_avvisi_dubbi")"

echo "Tutti i test delle migrazioni superati."
