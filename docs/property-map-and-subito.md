# Mappa immobili e fonte Subito

Stato registrato il 25 novembre 2026.

## Mappa immobili

La voce **Mappa immobili** si trova nel menu principale, nella sezione **Portafoglio e incarichi**.

La schermata legge i dati già presenti nel CRM e nell'archivio:
- `nmre_properties`: immobili CRM con stato `incarico`, `in_vendita`, `proposta`, `venduto` o `archiviato`.
- `annunci`: annunci dell'archivio che non sono già rappresentati da una scheda CRM mappabile.
- Se un annuncio è collegato a un immobile CRM, la scheda CRM prevale ed evita il doppio segnaposto.
- I filtri distinguono incarichi/in vendita, venduti e archivio.

### Posizioni e persistenza

Le coordinate sono salvate direttamente sulle schede:
- `annunci.indirizzo`, `annunci.latitude`, `annunci.longitude`.
- `nmre_properties.address`, `nmre_properties.latitude`, `nmre_properties.longitude`.
- Entrambe le tabelle conservano anche `location_precision` e `location_updated_at`.

La ricerca geografica parte su azione dell'utente tramite **Individua posizioni mancanti** oppure **Salva e posiziona**. Usa Nominatim/OpenStreetMap, con una richiesta al secondo e memorizzazione delle coordinate; il civico/via è preferito, mentre il solo comune è etichettato come posizione approssimativa. La mappa usa Leaflet e le piastrelle OpenStreetMap.

Le colonne e i vincoli sulle coordinate sono stati applicati al database Supabase e documentati nella migrazione:
`supabase/migrations/20261125090000_add_property_map_locations.sql`.

Le policy RLS proprietarie già esistenti restano attive su entrambe le tabelle; non è stata creata alcuna tabella pubblica e non sono state allargate le autorizzazioni.

### Uso

1. Registrare l'immobile nel CRM oppure nell'archivio.
2. Inserire via e civico quando disponibili.
3. Aprire **Mappa immobili**.
4. Usare **Salva e posiziona** sulla singola scheda oppure **Individua posizioni mancanti** per una geocodifica in sequenza.
5. Attivare i filtri per vedere le categorie desiderate.

Le righe esistenti senza indirizzo/coordinate non hanno posizioni inventate. Se non ci sono immobili CRM o annunci in archivio, la mappa resta senza segnaposti finché non vengono registrate le schede.

## Fonte Subito

Il pannello **Subito.it · Avvisi di ricerca** si trova in **Fonti e automazioni**. Utilizza il collegamento Gmail già esistente e mostra contatori delle schede Subito riconosciute, da verificare e classificate come private.

Per alimentarlo, salvare le ricerche su Subito e attivare gli avvisi via email. Il flusso riconosce le notifiche tramite Gmail; non crea un crawler, non visita in modo automatico i link di tracciamento e non invia messaggi agli inserzionisti.

Le email di benvenuto individuate nello storico sono state contrassegnate come scartate, non cancellate.

## Verifica tecnica

- Frontend: `index.html`.
- Funzione `nmre-search-engine`: versione 27, accetta anche il campo indirizzo durante la registrazione manuale nell'archivio.
- Il controllo automatico del codice applicativo e la build/deploy GitHub Pages sono risultati completati con esito positivo sul commit che contiene la mappa.
