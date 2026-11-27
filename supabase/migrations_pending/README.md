# Migrazioni in attesa di approvazione

I file in questa cartella **non** vengono applicati da `supabase db push`, da
`supabase migration up` né da un'eventuale integrazione automatica: la CLI di
Supabase legge solo `supabase/migrations/`.

| File | Contenuto | Stato |
|---|---|---|
| `20261125201000_gmail_dubious_alerts.sql` | Fase 2 · tabella `nmre_gmail_avvisi_dubbi` (avvisi dubbi) | **Non approvata, non applicata** |
| `20261126210000_quiet_unproven_subito_candidates.sql` | Trigger dei nuovi candidati: nessuna notifica per le schede Subito con novità non dimostrata (prerequisito di `NMRE_SUBITO_ITEM_CANDIDATES=true`) | **Non approvata, non applicata** |
| `20261127020000_subito_search_sync_log.sql` | Registro delle sincronizzazioni delle ricerche Subito (nuova tabella `nmre_subito_ricerche_sync`, nessuna tabella esistente modificata), prerequisito di `NMRE_SUBITO_FULL_SEARCH=true` | **Non approvata, non applicata** |
| `20261126200000_gmail_tokens_rpc_stable.sql` | `public.nmre_get_gmail_tokens()` dichiarata STABLE (solo volatilità), prerequisito della prova `nmre-subito-dry-run` | **Non approvata, non applicata** |

Quando la Fase 2 sarà approvata:
1. assegnare al file una versione successiva all'ultima registrata in produzione;
2. applicarlo dal SQL Editor, solo quel file (rapporto A1 §7, passo 6);
3. solo dopo, impostare `NMRE_CAPTURE_DUBIOUS_ALERTS=true`.

Il rollback resta in `supabase/rollback/20261125201000_gmail_dubious_alerts.rollback.sql`.
Il controllo `supabase/tests/check_migration_layout.sh` (in CI) fallisce se un file
della Fase 2 torna in `supabase/migrations/`.

Quando le schede singole Subito saranno approvate:
1. applicare dal SQL Editor `20261126210000_quiet_unproven_subito_candidates.sql` (solo quel file); richiede la
   protezione delle agenzie (`20261126004257`) già applicata e si interrompe in caso contrario;
2. distribuire `nmre-gmail-scheduled` e solo dopo impostare `NMRE_SUBITO_ITEM_CANDIDATES=true`;
3. rollback: prima rimuovere `NMRE_SUBITO_ITEM_CANDIDATES`, poi eseguire
   `supabase/rollback/20261126210000_quiet_unproven_subito_candidates.rollback.sql`.


Quando la migrazione STABLE dei token sarà approvata:
1. eseguire prima, in sola lettura, la verifica del corpo della funzione indicata nel README di
   `supabase/functions/nmre-subito-dry-run/`;
2. applicarla dal SQL Editor, solo quel file; si interrompe da sola se il corpo non è una
   singola SELECT;
3. rollback: `supabase/rollback/20261126200000_gmail_tokens_rpc_stable.rollback.sql`.

Quando l'acquisizione dell'intera ricerca Subito sarà approvata (dopo la prova reale):
1. applicare dal SQL Editor `20261127020000_subito_search_sync_log.sql` (solo quel file);
2. distribuire `nmre-gmail-scheduled` e solo dopo impostare `NMRE_SUBITO_FULL_SEARCH=true`;
3. rollback: prima rimuovere `NMRE_SUBITO_FULL_SEARCH`, poi eseguire
   `supabase/rollback/20261127020000_subito_search_sync_log.rollback.sql` (il registro resta).
