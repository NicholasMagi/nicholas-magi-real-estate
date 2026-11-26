// Richieste e conversione delle risposte di Immobiliare.it Insights, confrontate con la
// documentazione ufficiale (Comps API). Le fixture "documented_*" sono gli esempi di
// risposta della documentazione; gli annunci nelle Marche sono sintetici, costruiti
// sulla stessa struttura, e sono dichiarati come tali.
import {
  ALLOWED_MUNICIPALITIES, buildInsightsSearchPayload, formatInsightsDate, immobiliareListingKey, INSIGHTS_PAGE_LIMIT,
  isAllowedMunicipality, NMRE_BOUNDING_BOX, parseApiDate, toCandidate
} from "./provider.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected));
}
const fixture = (name: string) => JSON.parse(Deno.readTextFileSync(new URL("./fixtures/" + name, import.meta.url))).risposta;
const DOC_FULL = fixture("documented_full_search_example.json");
const DOC_DETAIL = fixture("documented_comparable_detail_example.json");
/** Annuncio sintetico nelle Marche, con la struttura dell'esempio documentato. */
function marcheItem(overrides: Record<string, Any> = {}) {
  const base = structuredClone(DOC_FULL.items[0]);
  return {
    ...base, uuid: "11111111-2222-4333-8444-555555555555", clientType: "Privato",
    listingUrl: "https://www.immobiliare.it/annunci/123456789/",
    location: { ...base.location, municipality: "Osimo", province: "Ancona", region: "Marche", municipalityID: 42034, address: "Via di prova", streetNumber: "1", zipCode: "60027" },
    extra: { ...base.extra, title: "Trilocale con terrazzo (sintetico)" },
    ...overrides
  };
}

Deno.test("richiesta: annunci in vendita, residenziali, nuovi o pubblicati, di privati (valori della documentazione)", () => {
  const payload = buildInsightsSearchPayload(new Date("2026-11-23T12:00:00Z"), 30, 2, 1, null) as Any;
  eq(payload.Filters.contractTypeID, 1, "contractTypeID 1 = Vendita");
  eq(payload.Filters.categoryTypeID, 1, "categoryTypeID 1 = Residenziale");
  eq(payload.Filters.clientTypeID, 1, "clientTypeID 1 = Privato");
  eq(payload.Filters.pubblicationStatusID, [1, 2], "pubblicationStatusID 1 = Nuovo, 2 = Pubblicato");
  eq("comparableTypeID" in payload.Filters, false, "fullSearchByAttribute: comparableTypeID non è tra i filtri documentati (solo dati Asking)");
  eq(payload.Filters.phoneNumberProvided, null, "ricerca principale senza filtro recapito: nessun privato escluso");
  eq(payload.Pagination, { page: 2, limit: INSIGHTS_PAGE_LIMIT }, "paginazione");
  eq(INSIGHTS_PAGE_LIMIT, 5, "limite predefinito documentato");
  eq(payload.Sorting, { by: "date", direction: "desc" }, "ordinamento per data, dal più recente");
  eq(payload.Filters.boundingBox.type, "Polygon", "area come GeoJSON Polygon");
  eq([payload.Filters.marketZoneID, payload.Filters.omiZoneID, payload.Filters.municipalityID], [null, null, null], "filtri d'area alternativi non usati insieme al boundingBox");
  const legacy = buildInsightsSearchPayload(new Date("2026-11-23T12:00:00Z"), 30, 1, 2, true, "searchByAttribute") as Any;
  eq([legacy.Filters.comparableTypeID, legacy.Filters.clientTypeID, legacy.Filters.phoneNumberProvided], [1, 2, true], "searchByAttribute: comparableTypeID 1 = Offerta");
});

Deno.test("date dei filtri nel formato delle richieste documentate (DD/MM/YYYY)", () => {
  eq(formatInsightsDate(new Date("2026-11-23T12:00:00Z")), "23/11/2026", "data");
  const payload = buildInsightsSearchPayload(new Date("2026-11-23T12:00:00Z"), 30) as Any;
  eq([payload.Filters.minDate, payload.Filters.maxDate], ["24/10/2026", "23/11/2026"], "periodo di 30 giorni");
  eq(parseApiDate("23/11/2026T00:00:00Z"), "2026-11-23T00:00:00.000Z", "data della risposta (formato predefinito)");
  eq(parseApiDate("23/11/2026"), "2026-11-23T00:00:00.000Z", "data della risposta (formato alternativo)");
  eq(parseApiDate("2025-09-01T00:00:00Z"), "2025-09-01T00:00:00.000Z", "data ISO come nell'esempio documentato");
});

Deno.test("area: comuni dell'allowlist riconosciuti anche con apostrofi tipografici; fuori area esclusi", () => {
  for (const name of ["Osimo", "Ancona", "Castelfidardo", "Loreto", "Recanati", "Camerano", "Numana", "Sirolo", "Jesi",
    "Porto Sant’Elpidio", "Porto Sant'Elpidio", "PORTO SANT ' ELPIDIO", "Morro d’Alba", "Monte San Vito", "Falconara Marittima"]) {
    eq(isAllowedMunicipality(name), true, "comune in area: " + name);
  }
  for (const name of ["Milano", "Pesaro", "Ascoli Piceno", "", null]) eq(isAllowedMunicipality(name), false, "fuori area: " + name);
  eq(ALLOWED_MUNICIPALITIES.size, 38, "comuni dell'allowlist");
  // Il rettangolo di ricerca contiene i comuni principali (coordinate pubbliche approssimate).
  const [[minLon, minLat], [maxLon], [, maxLat]] = [NMRE_BOUNDING_BOX.coordinates[0][0], NMRE_BOUNDING_BOX.coordinates[0][1], NMRE_BOUNDING_BOX.coordinates[0][2]];
  const towns: Record<string, [number, number]> = { Osimo: [13.48, 43.48], Ancona: [13.52, 43.62], Castelfidardo: [13.55, 43.46], Loreto: [13.61, 43.44],
    Recanati: [13.55, 43.40], Camerano: [13.55, 43.53], Numana: [13.62, 43.51], Sirolo: [13.62, 43.52], Jesi: [13.24, 43.52], Senigallia: [13.22, 43.72],
    Cupramontana: [13.12, 43.45], Fermo: [13.72, 43.16], "Porto Sant'Elpidio": [13.76, 43.25], Tolentino: [13.28, 43.21] };
  for (const [town, [lon, lat]] of Object.entries(towns)) eq(lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat, true, "dentro il rettangolo: " + town);
});

Deno.test("annuncio: tutti i campi documentati disponibili, nessun numero di telefono", () => {
  const candidate = toCandidate(marcheItem(), { ownerId: "u1", clientTypeID: 1, phoneFlag: true, requestId: "req-1", nowIso: "2026-11-26T10:00:00.000Z" })!;
  eq([candidate.titolo, candidate.comune, candidate.prezzo, candidate.superficie_mq, candidate.locali, candidate.bagni],
    ["Trilocale con terrazzo (sintetico)", "Osimo", 8200000, 370, 6, 4], "campi principali");
  eq([candidate.url, candidate.listing_key, candidate.dedup_key], ["https://www.immobiliare.it/annunci/123456789/", "immobiliare.it/annunci/123456789", "insights:immobiliare:11111111-2222-4333-8444-555555555555"], "link, chiave dell'immobile e UUID");
  eq([candidate.tipo_venditore, candidate.stato, candidate.contatto], ["Privato", "da_verificare", null], "privato, da verificare, nessun recapito inventato");
  eq(candidate.data_pubblicazione, "2025-09-01T00:00:00.000Z", "collectionDate = data di creazione dell'annuncio");
  const info = (candidate.dati_estratti as Any).insights;
  eq([info.listing_id, info.classe_energetica, info.stato_pubblicazione, info.tipo_inserzionista_dichiarato, info.filtro_recapito_segnalato], ["123456789", "C", "Nuovo", "Privato", true], "dati aggiuntivi");
  eq(info.immagini.length, 14, "fotografie");
  eq(/Brera/.test(info.descrizione), true, "descrizione");
  eq(info.caratteristiche.includes("Porta blindata"), true, "caratteristiche");
  eq(info.data_rimozione, "2025-09-01T00:00:00.000Z", "lastUpdateDate = data di rimozione per gli annunci in offerta");
  eq(/telefono|numero/i.test(JSON.stringify({ c: candidate.contatto })), false, "nessun campo telefono valorizzato");
  eq(/l'API non restituisce alcun numero/.test(candidate.seller_evidence), true, "evidenza: il filtro non è un numero di telefono");
});

Deno.test("annuncio: fuori area, link non affidabili, UUID mancante o professionista dichiarato esclusi", () => {
  eq(toCandidate(structuredClone(DOC_FULL.items[0]), { ownerId: "u1", clientTypeID: 1, phoneFlag: null }), null, "esempio documentato (Milano): fuori area");
  eq(toCandidate(marcheItem({ listingUrl: "https://example.com/annunci/123456789/" }), { ownerId: "u1", clientTypeID: 1, phoneFlag: null }), null, "link non Immobiliare.it");
  eq(toCandidate(marcheItem({ uuid: "" }), { ownerId: "u1", clientTypeID: 1, phoneFlag: null }), null, "senza UUID");
  eq(toCandidate(marcheItem({ clientType: "Professionista" }), { ownerId: "u1", clientTypeID: 1, phoneFlag: null }), null, "professionista dichiarato nella ricerca dei privati");
  eq(immobiliareListingKey("https://www.immobiliare.it/annunci/123456789/?utm_source=x"), "immobiliare.it/annunci/123456789", "chiave come per Gmail");
});

Deno.test("risposta incompleta: campi mancanti restano vuoti, nessun dato inventato", () => {
  const sparse = { uuid: "u-2", listingUrl: "https://www.immobiliare.it/annunci/987654321/", location: { municipality: "Ancona" }, propertyType: "Appartamento" };
  const candidate = toCandidate(sparse, { ownerId: "u1", clientTypeID: 1, phoneFlag: null })!;
  eq([candidate.titolo, candidate.prezzo, candidate.superficie_mq, candidate.locali, candidate.bagni, candidate.data_pubblicazione],
    ["Appartamento a Ancona", null, null, null, null, null], "valori assenti");
  const info = (candidate.dati_estratti as Any).insights;
  eq([info.descrizione, info.immagini.length, info.classe_energetica, info.filtro_recapito_segnalato, info.tipo_inserzionista_dichiarato], [null, 0, null, null, null], "dati aggiuntivi assenti");
  // L'esempio documentato del dettaglio (stessa struttura della ricerca completa) è convertibile.
  const detail = { ...structuredClone(DOC_DETAIL), uuid: "d-1", listingUrl: "https://www.immobiliare.it/annunci/119290871/", location: { ...(DOC_DETAIL.location || {}), municipality: "Jesi" } };
  eq(toCandidate(detail, { ownerId: "u1", clientTypeID: 1, phoneFlag: null })?.listing_key, "immobiliare.it/annunci/119290871", "dettaglio documentato");
});
