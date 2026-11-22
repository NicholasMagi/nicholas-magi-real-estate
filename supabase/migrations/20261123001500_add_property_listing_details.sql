-- Property details extracted from authorized real-estate portal notifications.
-- Additive schema migration: existing records and CRM history are preserved.

alter table public.annunci
  add column if not exists tipologia_immobile text,
  add column if not exists superficie_mq integer,
  add column if not exists locali numeric(4,1),
  add column if not exists camere integer,
  add column if not exists bagni integer;

alter table public.annunci_candidati
  add column if not exists tipologia_immobile text,
  add column if not exists superficie_mq integer,
  add column if not exists locali numeric(4,1),
  add column if not exists camere integer,
  add column if not exists bagni integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='annunci_superficie_mq_check' and conrelid='public.annunci'::regclass) then
    alter table public.annunci add constraint annunci_superficie_mq_check check (superficie_mq is null or superficie_mq between 1 and 100000);
  end if;
  if not exists (select 1 from pg_constraint where conname='annunci_locali_check' and conrelid='public.annunci'::regclass) then
    alter table public.annunci add constraint annunci_locali_check check (locali is null or locali between 0.5 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname='annunci_camere_check' and conrelid='public.annunci'::regclass) then
    alter table public.annunci add constraint annunci_camere_check check (camere is null or camere between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname='annunci_bagni_check' and conrelid='public.annunci'::regclass) then
    alter table public.annunci add constraint annunci_bagni_check check (bagni is null or bagni between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname='annunci_candidati_superficie_mq_check' and conrelid='public.annunci_candidati'::regclass) then
    alter table public.annunci_candidati add constraint annunci_candidati_superficie_mq_check check (superficie_mq is null or superficie_mq between 1 and 100000);
  end if;
  if not exists (select 1 from pg_constraint where conname='annunci_candidati_locali_check' and conrelid='public.annunci_candidati'::regclass) then
    alter table public.annunci_candidati add constraint annunci_candidati_locali_check check (locali is null or locali between 0.5 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname='annunci_candidati_camere_check' and conrelid='public.annunci_candidati'::regclass) then
    alter table public.annunci_candidati add constraint annunci_candidati_camere_check check (camere is null or camere between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname='annunci_candidati_bagni_check' and conrelid='public.annunci_candidati'::regclass) then
    alter table public.annunci_candidati add constraint annunci_candidati_bagni_check check (bagni is null or bagni between 0 and 100);
  end if;
end $$;

drop function if exists public.nmre_confirm_annuncio_candidato(uuid,text,text,numeric,text,text,text,text);

create or replace function public.nmre_confirm_annuncio_candidato(
  p_candidate_id uuid,
  p_titolo text,
  p_comune text,
  p_prezzo numeric default null,
  p_contatto text default null,
  p_tipo_venditore text default 'Da verificare',
  p_portale text default null,
  p_url text default null,
  p_tipologia_immobile text default null,
  p_superficie_mq integer default null,
  p_locali numeric default null,
  p_camere integer default null,
  p_bagni integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
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
  if p_superficie_mq is not null and p_superficie_mq not between 1 and 100000 then
    raise exception 'Superficie non valida';
  end if;
  if p_locali is not null and p_locali not between 0.5 and 100 then
    raise exception 'Numero locali non valido';
  end if;
  if p_camere is not null and p_camere not between 0 and 100 then
    raise exception 'Numero camere non valido';
  end if;
  if p_bagni is not null and p_bagni not between 0 and 100 then
    raise exception 'Numero bagni non valido';
  end if;

  select * into v_candidate
    from public.annunci_candidati
   where id = p_candidate_id and owner_id = v_user_id
   for update;
  if not found then
    raise exception 'Candidato non trovato o non autorizzato';
  end if;
  if v_candidate.stato = 'confermato' and v_candidate.annuncio_id is not null then
    return v_candidate.annuncio_id;
  end if;
  if v_candidate.stato <> 'da_verificare' then
    raise exception 'Il candidato non è più in attesa di verifica';
  end if;

  insert into public.annunci (
    owner_id,titolo,comune,prezzo,contatto,tipo_venditore,portale,url,
    tipologia_immobile,superficie_mq,locali,camere,bagni
  ) values (
    v_user_id,trim(p_titolo),trim(p_comune),p_prezzo,
    nullif(trim(coalesce(p_contatto,'')), ''),
    coalesce(p_tipo_venditore,'Da verificare'),
    nullif(trim(coalesce(p_portale,'')), ''),
    nullif(trim(coalesce(p_url,'')), ''),
    nullif(trim(coalesce(p_tipologia_immobile,'')), ''),
    p_superficie_mq,p_locali,p_camere,p_bagni
  )
  returning id into v_annuncio_id;

  update public.annunci_candidati
     set stato='confermato',annuncio_id=v_annuncio_id,updated_at=now()
   where id=p_candidate_id and owner_id=v_user_id;

  return v_annuncio_id;
end;
$function$;

revoke all on function public.nmre_confirm_annuncio_candidato(uuid,text,text,numeric,text,text,text,text,text,integer,numeric,integer,integer) from public;
grant execute on function public.nmre_confirm_annuncio_candidato(uuid,text,text,numeric,text,text,text,text,text,integer,numeric,integer,integer) to authenticated,service_role;
