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
