# Portal integration strategy

## Sources that can be connected directly

### Immobiliare.it Insights — documented API
Verificato il 26/11/2026 sulla documentazione ufficiale (https://insights.immobiliare.it/webdocs/service/comps/): Getting started, Search by Attribute, Full Search by Attribute, Search by Property, Comparable Detail (anche per ID annuncio), Mapping of output data, Taxonomies General e Location, Authentication, Errors. Le risposte reali non sono ancora state viste: mancano le credenziali.

**Cosa consente l'API (Comps API, host `comparables.realitycs.it`, sandbox `sandbox-comparables.realitycs.it`)**
- Autenticazione OAuth 2.0 password grant su `POST /oauth/token` (client ID e segreto in Basic auth); token valido 4 ore, da riusare: troppe autenticazioni possono causare un blocco temporaneo.
- `POST /comparables/fullSearchByAttribute`: ricerca per filtri con il **dettaglio completo di ogni risultato** (nessuna seconda chiamata per UUID), **solo per dati Asking** (annunci). È l'endpoint usato da NMRE.
- `POST /comparables/searchByAttribute`: stessa ricerca con un riepilogo per risultato; serve per le compravendite (che richiedono anche il dettaglio).
- `GET /comparable/<uuid>` e `GET /comparable/id/<listingId>` (solo Asking): dettaglio di un annuncio; NMRE usa il secondo per verificare il tipo di inserzionista delle opportunità già presenti con un link Immobiliare.it.
- `POST /comparables/searchByProperty`: ricerca per somiglianza a un immobile descritto (stime), non adatta all'acquisizione.
- Gli endpoint `/perizia/<uuid>/comparabili/...` (host `appraisal.realitycs.it`) sono un involucro del servizio Perizie: richiedono una perizia creata e una configurazione utente dedicata, «alternativa esclusiva» alla Comps API. Non sono usati.
- Valori dei filtri (Taxonomies General): `comparableTypeID` 1 = Offerta (3, 4, 6 = compravendite, solo su abilitazione); `contractTypeID` 1 = Vendita, 2 = Affitto; `categoryTypeID` 1 = Residenziale; `clientTypeID` 1 = Privato, 2 = Professionista; `pubblicationStatusID` 1 = Nuovo, 2 = Pubblicato, 3 = Rimosso, 4 = Inattivo.
- Date dei filtri: formato `DD/MM/YYYY` negli esempi delle richieste. La documentazione non dice esplicitamente quale data filtrano `minDate`/`maxDate` (esistono filtri separati per modifica e rimozione).
- Area: `boundingBox` (GeoJSON Polygon), `municipalityID`, `marketZoneID` o `omiZoneID`, in alternativa tra loro.
- Paginazione: `Pagination.page` e `limit` (predefinito **5**, valori diversi su richiesta al Sales team); risposta con `_metadata.total_count` e `_metadata.pages` (`first`, `last`, `next`, `previous`, `self`).
- Campi restituiti (Mapping of output data): UUID, link dell'annuncio (`listingUrl`, solo Asking), titolo, descrizione, prezzo richiesto, comune e indirizzo, coordinate, superficie, locali, bagni, piano, classe energetica, caratteristiche, fotografie, stato di pubblicazione, `clientType` («Privato»/«Professionista», se disponibile), `collectionDate` (creazione dell'annuncio), `lastUpdateDate` (rimozione, per gli annunci). Sono garantiti solo i campi con asterisco; gli altri possono essere null.
- **Nessun numero di telefono né recapito** è previsto nell'output. `phoneNumberProvided` è solo un filtro booleano della ricerca, il cui significato non è descritto.

**Come lo usa NMRE (`nmre-insights-sync`)**
- Ricerca di tutti gli annunci in vendita, residenziali, nuovi o pubblicati, di privati, negli ultimi 1–90 giorni, nel rettangolo delle Marche; poi la stessa ricerca con `phoneNumberProvided=true` solo per annotare il filtro sugli annunci (mai un numero).
- Paginazione fino all'ultima pagina dichiarata (limite di sicurezza 200 pagine e tempo massimo): se non si arriva in fondo il risultato è dichiarato **parziale**. Qualsiasi errore della ricerca: **nessuna scrittura**.
- Solo i comuni dell'allowlist (nomi confrontati senza accenti e con apostrofi uniformati).
- Confronto con Opportunità, Scartati e Archiviati (link, chiave `immobiliare.it/annunci/<id>`, UUID) e con la tabella `annunci` dell'Archivio (anche immobili inseriti a mano o eliminati): nessun duplicato, nessuna riapertura. Se una lettura fallisce, nessun inserimento.
- Nuovi annunci inseriti «Da verificare», tipo venditore «Privato» dalla ricerca ufficiale, con descrizione, foto e dati in `dati_estratti.insights`; il campo contatto resta vuoto.
- Sulle opportunità già presenti cambia solo la classificazione del venditore, e solo se in attesa e non verificata a mano. Titoli, prezzi, note, stati e decisioni non vengono modificati.

Segreti richiesti (Edge Function): INSIGHTS_CLIENT_ID, INSIGHTS_CLIENT_SECRET, INSIGHTS_USERNAME, INSIGHTS_PASSWORD, NMRE_INSIGHTS_ENV (sandbox salvo diversa indicazione).

**Autorizzazione.** `INSIGHTS_LEAD_USE_APPROVED=true` deve restare disattivato finché Immobiliare.it Insights non conferma per iscritto che la licenza consente di usare i risultati per l'acquisizione immobiliare (contatto dei privati). La documentazione tecnica non lo dice; le condizioni generali del portale vietano lo sfruttamento commerciale non autorizzato dei dati. Un token API da solo non è un'autorizzazione.

## Sources that require portal approval

### Idealista Search API
Idealista publicly documents the existence and purpose of Search API, but key issuance requires an access request and project description. The API contract details are not sufficiently available in the public access page to safely hard-code an endpoint, token flow or response schema. No guessed endpoint is enabled. Once the provider supplies the official integration documentation and credentials, create the adapter from that contract.

Access request: https://developers.idealista.com/access-request

## Sources with different integration purposes

- Green-Acres documents an XML feed for sending an agency's own listings to Green-Acres. It is an outbound publishing integration, not a search API for privately advertised properties.
- Subito documents authorized real-estate CRM integrations for publishing/managing professional adverts. Its terms also restrict contacting advertisers to propose intermediation services. NMRE does not scrape Subito or automate such outreach.
- Casa.it, Gate-away, Trovacasa and Wikicasa remain supported as possible Gmail alert sources when their account alerts arrive in the connected mailbox. No direct inbound public API is assumed without provider documentation or a signed data agreement.

## General collection policy
Direct imports must use provider-issued credentials, feeds or contracts. No CAPTCHA bypass, login scraping, hidden endpoint probing or bulk harvesting of personal contact details is implemented. Ambiguous sellers remain in manual review.