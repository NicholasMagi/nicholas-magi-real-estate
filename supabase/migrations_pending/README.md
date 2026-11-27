# Migrazioni in attesa di approvazione

I file in questa cartella **non** vengono applicati da `supabase db push`, da
`supabase migration up` né da un'eventuale integrazione automatica: la CLI di
Supabase legge solo `supabase/migrations/`.

| File | Contenuto | Stato |
|---|---|---|
| `20261125201000_gmail_dubious_alerts.sql` | Fase 2 · tabella `nmre_gmail_avvisi_dubbi` (avvisi dubbi) | **Non approvata, non applicata** |
| `20261126200000_gmail_tokens_rpc_stable.sql` | `public.nmre_get_gmail_tokens()` dichiarata STABLE (solo volatilità), prerequisito della prova `nmre-subito-dry-run` | **Non approvata, non applicata** |

Quando la Fase 2 sarà approvata:
1. assegnare al file una versione successiva all'ultima registrata in produzione;
2. applicarlo dal SQL Editor, solo quel file (rapporto A1 §7, passo 6);
3. solo dopo, impostare `NMRE_CAPTURE_DUBIOUS_ALERTS=true`.

Il rollback resta in `supabase/rollback/20261125201000_gmail_dubious_alerts.rollback.sql`.
Il controllo `supabase/tests/check_migration_layout.sh` (in CI) fallisce se un file
della Fase 2 torna in `supabase/migrations/`.

Quando la migrazione STABLE dei token sarà approvata:
1. eseguire prima, in sola lettura, la verifica del corpo della funzione indicata nel README di
   `supabase/functions/nmre-subito-dry-run/`;
2. applicarla dal SQL Editor, solo quel file; si interrompe da sola se il corpo non è una
   singola SELECT;
3. rollback: `supabase/rollback/20261126200000_gmail_tokens_rpc_stable.rollback.sql`.
