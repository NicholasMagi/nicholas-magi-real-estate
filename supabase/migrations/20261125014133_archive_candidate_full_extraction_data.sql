do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef('public.nmre_confirm_annuncio_candidato(uuid,text,text,numeric,text,text,text,text,text,integer,numeric,integer,integer)'::regprocedure);

  v_old := E'owner_id, titolo, comune, prezzo, contatto, tipo_venditore, portale, url,\n    tipologia_immobile, superficie_mq, locali, camere, bagni';
  v_new := E'owner_id, titolo, comune, indirizzo, prezzo, contatto, tipo_venditore, portale, url,\n    data_pubblicazione, tipologia_immobile, superficie_mq, locali, camere, bagni,\n    source_candidate_id, url_originale, source_email_id, notification_sender, email_subject,\n    seller_identity, seller_confidence, seller_evidence, seller_manual_override,\n    seller_classification_version, data_extraction_version, listing_key, dati_fonte, dati_estratti';
  if position(v_old in v_definition) = 0 then raise exception 'Blocco colonne della funzione di conferma non trovato'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := E'v_user_id, trim(p_titolo), trim(p_comune), p_prezzo,\n    nullif(trim(coalesce(p_contatto, '''')), ''''),\n    coalesce(p_tipo_venditore, ''Da verificare''),\n    nullif(trim(coalesce(p_portale, '''')), ''''),\n    nullif(trim(coalesce(p_url, '''')), ''''),\n    nullif(trim(coalesce(p_tipologia_immobile, '''')), ''''),\n    p_superficie_mq, p_locali, p_camere, p_bagni';
  v_new := E'v_user_id, trim(p_titolo), trim(p_comune),\n    nullif(trim(v_candidate.dati_estratti #>> ''{pagina_pubblica,suggestions,indirizzo}''), ''''),\n    p_prezzo, nullif(trim(coalesce(p_contatto, '''')), ''''),\n    coalesce(p_tipo_venditore, ''Da verificare''),\n    nullif(trim(coalesce(p_portale, '''')), ''''),\n    coalesce(nullif(trim(coalesce(p_url, '''')), ''''), v_candidate.url),\n    v_candidate.data_pubblicazione,\n    nullif(trim(coalesce(p_tipologia_immobile, '''')), ''''),\n    p_superficie_mq, p_locali, p_camere, p_bagni,\n    v_candidate.id, coalesce(v_candidate.url_originale, v_candidate.url, p_url),\n    v_candidate.source_email_id, v_candidate.notification_sender, v_candidate.email_subject,\n    v_candidate.seller_identity, v_candidate.seller_confidence, v_candidate.seller_evidence,\n    v_candidate.seller_manual_override, v_candidate.seller_classification_version,\n    v_candidate.data_extraction_version, v_candidate.listing_key, v_candidate.dati_fonte, v_candidate.dati_estratti';
  if position(v_old in v_definition) = 0 then raise exception 'Blocco valori della funzione di conferma non trovato'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;

  v_definition := pg_get_functiondef('public.nmre_auto_archive_private_candidate(uuid)'::regprocedure);
  v_old := 'owner_id,titolo,comune,prezzo,contatto,tipo_venditore,portale,url,';
  v_new := 'owner_id,indirizzo,titolo,comune,prezzo,contatto,tipo_venditore,portale,url,';
  if position(v_old in v_definition) = 0 then raise exception 'Blocco colonne della funzione di archiviazione automatica non trovato'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'v_candidate.owner_id,v_candidate.titolo,v_candidate.comune,v_candidate.prezzo,';
  v_new := 'v_candidate.owner_id,nullif(trim(v_candidate.dati_estratti #>> ''{pagina_pubblica,suggestions,indirizzo}''), ''''),v_candidate.titolo,v_candidate.comune,v_candidate.prezzo,';
  if position(v_old in v_definition) = 0 then raise exception 'Blocco valori della funzione di archiviazione automatica non trovato'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := E'dati_fonte=coalesce(dati_fonte,v_candidate.dati_fonte),\n        dati_estratti=coalesce(dati_estratti,v_candidate.dati_estratti)';
  v_new := E'indirizzo=coalesce(indirizzo,nullif(trim(v_candidate.dati_estratti #>> ''{pagina_pubblica,suggestions,indirizzo}''), '''')),\n        dati_fonte=coalesce(dati_fonte,v_candidate.dati_fonte),\n        dati_estratti=coalesce(dati_estratti,v_candidate.dati_estratti)';
  if position(v_old in v_definition) = 0 then raise exception 'Blocco aggiornamento duplicati della funzione di archiviazione automatica non trovato'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$migration$;
