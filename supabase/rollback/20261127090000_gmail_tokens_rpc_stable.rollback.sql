-- =====================================================================
-- ROLLBACK di 20261127090000_gmail_tokens_rpc_stable
-- =====================================================================
-- Riporta public.nmre_get_gmail_tokens() a VOLATILE (impostazione precedente).
-- Corpo, SECURITY DEFINER e permessi non vengono toccati. Nessun dato coinvolto.
-- Dopo il rollback la prova nmre-subito-dry-run non può leggere i token in GET
-- e si interrompe senza scritture.
-- =====================================================================
do $rollback$
declare
  v_count integer;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nmre_get_gmail_tokens';
  if v_count <> 1 then
    raise exception 'Attese una sola funzione public.nmre_get_gmail_tokens, trovate %: rollback non eseguito', v_count;
  end if;
  execute 'alter function public.nmre_get_gmail_tokens() volatile';
  raise notice 'public.nmre_get_gmail_tokens() riportata a VOLATILE';
end;
$rollback$;

notify pgrst, 'reload schema';
