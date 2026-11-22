# Pipeline di importazione Gmail: specifica tecnica

## Stato

Il lettore Gmail già distribuito restituisce metadati e anteprima delle email. Non è ancora un importatore di annunci e non va descritto come tale.

In questo branch è stato aggiunto un parser conservativo e indipendente:
- legge le parti MIME `text/plain` e, in assenza, `text/html`;
- propone titolo, comune, prezzo, mittente, dominio sorgente e URL;
- produce una chiave per individuare probabili duplicati;
- mantiene sempre `tipo_venditore = "Da verificare"`;
- non salva nulla nel database.

## Flusso previsto

1. Il lettore Gmail recupera i messaggi e i relativi payload MIME tramite Gmail API.
2. Il parser trasforma ogni messaggio in un candidato.
3. Il server confronta la chiave di deduplicazione con quelle già viste.
4. I candidati nuovi o modificati vengono mostrati in una coda di revisione.
5. L'utente verifica fonte, link, comune, prezzo e tipologia del venditore.
6. Solo dopo conferma esplicita il candidato viene inserito in `annunci`.

## Contratto candidato

Il parser produce i campi corrispondenti all'attuale archivio:
`titolo`, `comune`, `prezzo`, `contatto`, `tipo_venditore`, `portale`, `url`.

Aggiunge inoltre metadati interni:
`messageId`, `deduplicationKey`, `allUrls`, `receivedAt`, `reviewStatus`, `warnings`.

Questi metadati non devono essere scritti nella tabella `annunci` finché lo schema reale non è stato verificato. Per la coda serve una tabella dedicata con vincolo univoco su account e chiave di deduplicazione.

## Limiti intenzionali

- Le email dei portali non hanno un formato standard: le estrazioni sono suggerimenti, non dati certificati.
- Il mittente di una notifica è il portale, non il venditore dell'immobile.
- Non si presume che il primo URL sia sempre il link all'annuncio: l'interfaccia deve consentire di correggerlo.
- Gli allegati non vengono scaricati o interpretati da questo parser.
- Nessuna classificazione automatica come "Privato" o "Agenzia".
- Nessuna importazione automatica definitiva.

## Prima del rilascio

Occorre collegarsi a Supabase e leggere il codice effettivo della Edge Function `nmre-gmail-reader`, quindi integrarla con questo parser, aggiungere la coda di revisione e verificare schema e policy RLS. Il deploy va eseguito solo dopo test con email campione reali, oscurando dati personali.
