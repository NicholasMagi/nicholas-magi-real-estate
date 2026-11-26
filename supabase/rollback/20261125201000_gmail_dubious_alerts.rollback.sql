-- =====================================================================
-- ROLLBACK di 20261125201000_gmail_dubious_alerts
-- =====================================================================
-- Passo 1 (sempre, prima di questo script): impostare
-- NMRE_CAPTURE_DUBIOUS_ALERTS=false (o rimuoverla) sulla funzione
-- nmre-gmail-scheduled. Con il flag spento la funzione non usa la tabella.
--
-- Passo 2 (questo script): ritira l'accesso dall'applicazione SENZA cancellare
-- i dati raccolti. Il pannello "Avvisi dubbi" si nasconde da solo quando la
-- tabella non è leggibile.
-- =====================================================================
revoke all on table public.nmre_gmail_avvisi_dubbi from authenticated;

-- Passo 3 (FACOLTATIVO e IRREVERSIBILE, solo con approvazione esplicita e dopo
-- un'esportazione): eliminazione della tabella e dei riferimenti raccolti.
-- drop table public.nmre_gmail_avvisi_dubbi;
