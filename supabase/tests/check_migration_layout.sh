#!/usr/bin/env bash
# Controllo statico della cartella delle migrazioni (nessun database).
# Garantisce che:
#  - la migrazione della Fase 2 (avvisi dubbi) NON sia in supabase/migrations/, così
#    che nessun "supabase db push" o integrazione automatica possa applicarla;
#  - le due protezioni abbiano le versioni registrate in produzione;
#  - i nomi interni usati per i backup dei trigger (e quindi dai rollback) non cambino.
set -euo pipefail
# NMRE_LAYOUT_ROOT consente di eseguire il controllo su una copia (auto-verifica in CI).
ROOT="${NMRE_LAYOUT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
MIG="$ROOT/supabase/migrations"
fail=0
ok()   { echo "ok   $1"; }
bad()  { echo "FAIL $1" >&2; fail=1; }

# 1. Nessuna migrazione della Fase 2 nella cartella applicabile
if ls "$MIG" | grep -qi 'dubious'; then bad "un file della Fase 2 è in supabase/migrations/"; else ok "nessun file della Fase 2 in supabase/migrations/"; fi
if grep -lqi 'nmre_gmail_avvisi_dubbi' "$MIG"/*.sql 2>/dev/null; then bad "una migrazione applicabile crea o modifica nmre_gmail_avvisi_dubbi"; else ok "nessuna migrazione applicabile tocca nmre_gmail_avvisi_dubbi"; fi
[[ -f "$ROOT/supabase/migrations_pending/20261125201000_gmail_dubious_alerts.sql" ]] && ok "Fase 2 conservata in supabase/migrations_pending/" || bad "migrazione della Fase 2 mancante in supabase/migrations_pending/"

# 1-bis. Migrazione STABLE dei token Gmail: in attesa di approvazione, non applicabile
if ls "$MIG" | grep -qi 'gmail_tokens_rpc_stable'; then bad "la migrazione STABLE dei token è in supabase/migrations/ senza approvazione"; else ok "migrazione STABLE dei token non applicabile automaticamente"; fi
[[ -f "$ROOT/supabase/migrations_pending/20261126200000_gmail_tokens_rpc_stable.sql" ]] && ok "migrazione STABLE dei token conservata in supabase/migrations_pending/" || bad "migrazione STABLE dei token mancante in supabase/migrations_pending/"
latest_applied=$(ls "$MIG" | cut -d_ -f1 | sort | tail -1)
[[ "20261126200000" > "$latest_applied" ]] && ok "versione della migrazione STABLE successiva all'ultima applicabile ($latest_applied)" || bad "versione della migrazione STABLE non successiva a $latest_applied"
[[ "20261126200000" < "$(date -u +%Y%m%d%H%M%S)" ]] && ok "versione della migrazione STABLE non nel futuro" || bad "versione della migrazione STABLE nel futuro"
[[ -f "$ROOT/supabase/rollback/20261126200000_gmail_tokens_rpc_stable.rollback.sql" ]] && ok "rollback della migrazione STABLE dei token presente" || bad "rollback della migrazione STABLE dei token mancante"

# 1-ter. Notifiche delle schede Subito con novità non dimostrata: in attesa di approvazione
if ls "$MIG" | grep -qi 'quiet_unproven_subito_candidates'; then bad "la migrazione delle schede Subito è in supabase/migrations/ senza approvazione"; else ok "migrazione delle schede Subito non applicabile automaticamente"; fi
[[ -f "$ROOT/supabase/migrations_pending/20261126210000_quiet_unproven_subito_candidates.sql" && -f "$ROOT/supabase/rollback/20261126210000_quiet_unproven_subito_candidates.rollback.sql" ]] \
  && ok "migrazione delle schede Subito e rollback presenti" || bad "migrazione o rollback delle schede Subito mancanti"

# 1-quater. Registro delle ricerche Subito (intera ricerca): in attesa di approvazione
if ls "$MIG" | grep -qi 'subito_search_sync_log'; then bad "la migrazione del registro Subito è in supabase/migrations/ senza approvazione"; else ok "migrazione del registro Subito non applicabile automaticamente"; fi
if grep -lqi 'nmre_subito_ricerche_sync' "$MIG"/*.sql 2>/dev/null; then bad "una migrazione applicabile tocca nmre_subito_ricerche_sync"; else ok "nessuna migrazione applicabile tocca nmre_subito_ricerche_sync"; fi
[[ -f "$ROOT/supabase/migrations_pending/20261127020000_subito_search_sync_log.sql" && -f "$ROOT/supabase/rollback/20261127020000_subito_search_sync_log.rollback.sql" ]] \
  && ok "migrazione del registro Subito e rollback presenti" || bad "migrazione o rollback del registro Subito mancanti"
[[ "20261127020000" > "$latest_applied" ]] && ok "versione del registro Subito successiva all'ultima applicabile" || bad "versione del registro Subito non successiva a $latest_applied"
[[ "20261127020000" < "$(date -u +%Y%m%d%H%M%S)" ]] && ok "versione del registro Subito non nel futuro" || bad "versione del registro Subito nel futuro"

# 2. Versioni delle protezioni allineate alla produzione
for f in 20261126004257_guard_agency_candidate_notifications.sql 20261126004310_guard_agency_price_drop_notifications.sql; do
  [[ -f "$MIG/$f" ]] && ok "presente $f" || bad "mancante $f"
done
if ls "$MIG" | grep -Eq '^2026112520(0000|2000)_'; then bad "sono rimaste le vecchie versioni locali delle protezioni"; else ok "nessuna vecchia versione locale delle protezioni"; fi

# 3. Nomi interni dei backup invariati, nelle migrazioni e nei rollback
check_internal() { # file nome_interno
  grep -q "'$2'" "$1" && ok "nome interno $2 in $(basename "$1")" || bad "nome interno $2 assente in $(basename "$1")"
}
check_internal "$MIG/20261126004257_guard_agency_candidate_notifications.sql" 20261125200000_guard_agency_candidate_notifications
check_internal "$ROOT/supabase/rollback/20261126004257_guard_agency_candidate_notifications.rollback.sql" 20261125200000_guard_agency_candidate_notifications
check_internal "$MIG/20261126004310_guard_agency_price_drop_notifications.sql" 20261125202000_guard_agency_price_drop_notifications
check_internal "$ROOT/supabase/rollback/20261126004310_guard_agency_price_drop_notifications.rollback.sql" 20261125202000_guard_agency_price_drop_notifications

# 4. Versioni uniche e ordinate (nessun duplicato di prefisso)
dups=$(ls "$MIG" | cut -d_ -f1 | sort | uniq -d)
[[ -z "$dups" ]] && ok "nessuna versione duplicata" || bad "versioni duplicate: $dups"

if [[ $fail -ne 0 ]]; then echo "Controllo della cartella delle migrazioni NON superato" >&2; exit 1; fi
echo "Controllo della cartella delle migrazioni superato."
