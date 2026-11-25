# Gmail Push Notifications for NMRE

NMRE keeps the existing one-minute incremental Gmail sync as a fallback. Gmail Push adds an authenticated Pub/Sub callback so new mailbox activity can trigger the same incremental processor without waiting for the next minute.

## Google Cloud setup

1. Select the Google Cloud project used for the Gmail OAuth client. Enable **Gmail API** and **Cloud Pub/Sub API**.
2. Create a Pub/Sub topic named `nmre-gmail-updates`. Its full resource name is `projects/PROJECT_ID/topics/nmre-gmail-updates`.
3. Grant the Gmail push publisher identity `gmail-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher** role on that topic.
4. Create a service account for authenticated push delivery, for example `nmre-gmail-push@PROJECT_ID.iam.gserviceaccount.com`.
5. In the project's IAM page, grant the Pub/Sub service agent `service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com` the **Service Account Token Creator** role on that push service account.
6. Create a push subscription for the topic. Set the endpoint to:
   `https://hhircfmrtkgaybrougku.supabase.co/functions/v1/nmre-gmail-push`
   Enable authenticated delivery with the service account from step 4. Set the OIDC audience to the exact same endpoint URL and include the service-account email in the token.
7. In Supabase **Project Settings → Edge Functions → Secrets**, add:
   - `GMAIL_PUBSUB_TOPIC_NAME`: full topic resource name from step 2.
   - `GMAIL_PUBSUB_AUDIENCE`: exact OIDC audience / endpoint URL from step 6.
   - `GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL`: service account email from step 4.
   - `GMAIL_PUBSUB_SUBSCRIPTION`: full subscription resource name (optional, but recommended).
8. The existing one-minute Gmail worker will register or renew Gmail's Watch automatically after the topic secret is present. Watch is renewed when less than 24 hours remain; the one-minute poll remains active as a recovery path.

## Validation

Send a new test email to the connected Gmail mailbox. Check the Supabase Edge Function logs for `nmre-gmail-push` and `nmre-gmail-scheduled`, then confirm a successful row appears in `nmre_gmail_sync_runs`. Do not reduce the one-minute fallback until push delivery has been observed reliably.

## Security and reliability

- Pub/Sub delivery is authenticated with a Google-signed OIDC JWT; the handler validates issuer, signature, audience, service-account email and (if configured) subscription name.
- Gmail message contents are not included in Pub/Sub. The callback only uses the notification as a trigger; the existing Gmail API history cursor remains the source of truth.
- A database lease lock prevents the one-minute fallback and push-triggered sync from processing the mailbox concurrently.
- The existing incremental history sync, seller classification, manual overrides, candidate deduplication and archival rules remain in place.


## Deduplicazione cross-portale (sorgente in revisione, non distribuita)
- La chiave Gmail impedisce il reimport della stessa email; la chiave URL riconosce la stessa scheda anche con parametri di tracciamento diversi.
- In aggiunta, il worker confronta le nuove notifiche con i candidati dello stesso account e dello stesso comune, usando tipologia, indirizzo/civico, superficie, locali, camere, bagni, prezzo e somiglianza del titolo.
- L'unione automatica richiede un indirizzo/civico coerente e caratteristiche compatibili, oppure una combinazione molto forte di tipologia, metratura, prezzo e altri attributi indipendenti.
- Le corrispondenze non sufficienti restano candidate distinte e vengono marcate con riferimento, confidenza e motivazione per una revisione successiva.
- Ogni email resta registrata in annunci_candidati_notifiche con il suo link e prezzo; quando due schede pending vengono unite, lo storico email viene ricollegato alla scheda canonica senza cancellare la scheda storica.
- Non si usano mittente, email o recapiti del venditore come identità dell'immobile. Comuni diversi e civici discordanti non vengono associati automaticamente.
- Prima del deploy è obbligatorio applicare la migration additiva che introduce i tre campi possible_duplicate_*; schema e funzione non vengono distribuiti in produzione in questa fase.


## Regola di archiviazione dei privati
- Il worker Gmail può chiamare nmre_auto_archive_private_candidate per i candidati classificati Privato; la funzione SQL è il gate che decide se la prova è sufficiente.
- L'archiviazione automatica è consentita solo con etichetta esplicita del venditore privato (confidence almeno 99 e prova allowlistata) oppure dopo verifica manuale esplicita del privato.
- Segnali più deboli (ad esempio “annuncio tra privati”, “senza agenzia” o vendita dichiarata dal proprietario con confidenza sotto soglia) restano nelle Opportunità.
- Sono inoltre obbligatori titolo e comune. Se mancano, l'annuncio resta da completare e può essere inserito manualmente dopo verifica.
- auto_archived_count registra esclusivamente gli inserimenti avvenuti grazie a queste condizioni.
- La app mobile archivia inoltre su azione esplicita Archivia in archivio. Scarta non crea record nella tabella annunci.
- Nessuna riga già presente nell'archivio viene rimossa o modificata da questa modifica.
