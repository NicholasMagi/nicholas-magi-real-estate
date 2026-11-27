-- =====================================================================
-- ROLLBACK di 20261127020000_subito_search_sync_log
-- =====================================================================
-- Passo 1 (sempre, prima di questo script): rimuovere NMRE_SUBITO_FULL_SEARCH
-- (o impostarla a false) sulla funzione nmre-gmail-scheduled. Con la variabile
-- spenta la funzione non usa la tabella.
--
-- Passo 2 (questo script): ritira l'accesso dall'applicazione SENZA cancellare
-- il registro. Il pannello «Ricerche Subito» si nasconde da solo quando la
-- tabella non è leggibile.
-- =====================================================================
revoke all on table public.nmre_subito_ricerche_sync from authenticated;
notify pgrst, 'reload schema';

-- Passo 3 (FACOLTATIVO e IRREVERSIBILE, solo con approvazione esplicita e dopo
-- un'esportazione): eliminazione della tabella e del registro.
-- drop table public.nmre_subito_ricerche_sync;
