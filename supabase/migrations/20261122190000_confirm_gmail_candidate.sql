-- Confirm a reviewed Gmail candidate atomically.
-- Run this migration in Supabase before deploying the matching application branch.

create or replace function public.nmre_confirm_annuncio_candidato(
  p_candidate_id uuid,
  p_titolo text,
  p_comune text,
  p_prezzo numeric default null,
  p_contatto text default null,
  p_tipo_venditore text default 'Da verificare',
  p_portale text default null,
  p_url text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_candidate public.annunci_candidati%rowtype;
  v_annuncio_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Autenticazione richiesta';
  end if;

  if coalesce(trim(p_titolo), '') = '' or coalesce(trim(p_comune), '') = '' then
    raise exception 'Titolo e comune sono obbligatori';
  end if;

  if p_prezzo is not null and p_prezzo < 0 then
    raise exception 'Il prezzo non può essere negativo';
  end if;

  if coalesce(p_tipo_venditore, 'Da verificare') not in ('Da verificare', 'Privato', 'Agenzia') then
    raise exception 'Tipologia venditore non valida';
  end if;

  select *
    into v_candidate
    from public.annunci_candidati
   where id = p_candidate_id
     and owner_id = v_user_id
   for update;

  if not found then
    raise exception 'Candidato non trovato o non autorizzato';
  end if;

  -- Repeated requests are idempotent: never create a second listing.
  if v_candidate.stato = 'confermato' and v_candidate.annuncio_id is not null then
    return v_candidate.annuncio_id;
  end if;

  if v_candidate.stato <> 'da_verificare' then
    raise exception 'Il candidato non è più in attesa di verifica';
  end if;

  insert into public.annunci (
    owner_id, titolo, comune, prezzo, contatto,
    tipo_venditore, portale, url
  ) values (
    v_user_id, trim(p_titolo), trim(p_comune), p_prezzo,
    nullif(trim(coalesce(p_contatto, '')), ''),
    coalesce(p_tipo_venditore, 'Da verificare'),
    nullif(trim(coalesce(p_portale, '')), ''),
    nullif(trim(coalesce(p_url, '')), '')
  )
  returning id into v_annuncio_id;

  update public.annunci_candidati
     set stato = 'confermato',
         annuncio_id = v_annuncio_id,
         updated_at = now()
   where id = p_candidate_id
     and owner_id = v_user_id;

  return v_annuncio_id;
end;
$$;

revoke all on function public.nmre_confirm_annuncio_candidato(
  uuid, text, text, numeric, text, text, text, text
) from public, anon;

grant execute on function public.nmre_confirm_annuncio_candidato(
  uuid, text, text, numeric, text, text, text, text
) to authenticated;
