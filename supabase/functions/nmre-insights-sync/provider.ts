// Immobiliare.it Insights – Comps API (documentazione ufficiale:
// https://insights.immobiliare.it/webdocs/service/comps/). Funzioni pure: richieste e
// conversione delle risposte, senza rete né database.
//
// Valori verificati sulla documentazione (Taxonomies General):
//   comparableTypeID 1 = Offerta (annunci in vendita/affitto; 3, 4, 6 = compravendite,
//                        accessibili solo su richiesta al Sales team)
//   contractTypeID   1 = Vendita (2 = Affitto)
//   categoryTypeID   1 = Residenziale
//   clientTypeID     1 = Privato, 2 = Professionista
//   pubblicationStatusID 1 = Nuovo, 2 = Pubblicato (3 = Rimosso, 4 = Inattivo)
// Le date dei filtri sono "DD/MM/YYYY" (esempi delle richieste); il formato
// "DD/MM/YYYYT00:00:00Z" è documentato per le risposte.

export const ALLOWED_MUNICIPALITIES = new Set([
  "castelfidardo", "ancona", "osimo", "loreto", "recanati", "camerano",
  "numana", "sirolo", "jesi", "macerata", "fermo", "senigallia",
  "filottrano", "polverigi", "agugliano", "offagna", "chiaravalle",
  "ostra", "tolentino", "staffolo", "cupramontana", "monsano",
  "trecastelli", "corridonia", "montegranaro", "porto sant'elpidio",
  "porto recanati", "porto san giorgio", "civitanova marche",
  "falconara marittima", "santa maria nuova", "maiolati spontini",
  "monte san vito", "monte urano", "monte roberto", "montecassiano",
  "morro d'alba", "montemarciano"
]);

/** Rettangolo che contiene tutti i comuni dell'allowlist (GeoJSON Polygon, lon/lat). */
export const NMRE_BOUNDING_BOX = {
  type: "Polygon",
  coordinates: [[
    [13.00, 43.00],
    [14.15, 43.00],
    [14.15, 43.90],
    [13.00, 43.90],
    [13.00, 43.00]
  ]]
};

/** Risultati per pagina: 5 è il valore predefinito documentato (valori diversi su richiesta al Sales team). */
export const INSIGHTS_PAGE_LIMIT = 5;

/**
 * Nome del comune confrontabile: senza accenti, minuscolo, apostrofi tipografici e
 * trattini uniformati ("Porto Sant’Elpidio" = "porto sant'elpidio").
 */
export function normalizeMunicipality(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
    .replace(/\s*'\s*/g, "'")
    .replace(/[-\u2010-\u2015]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("it");
}

export function isAllowedMunicipality(value: unknown): boolean {
  return ALLOWED_MUNICIPALITIES.has(normalizeMunicipality(value));
}

/** Data dei filtri nel formato delle richieste documentate: DD/MM/YYYY. */
export function formatInsightsDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return day + "/" + month + "/" + date.getUTCFullYear();
}

export type InsightsEndpoint = "fullSearchByAttribute" | "searchByAttribute";

/**
 * Corpo della ricerca. fullSearchByAttribute (consigliata: dettaglio completo di ogni
 * risultato, solo dati Asking) non prevede comparableTypeID tra i filtri documentati;
 * searchByAttribute lo richiede.
 */
export function buildInsightsSearchPayload(
  now: Date,
  lookbackDays = 30,
  page = 1,
  clientTypeID: 1 | 2 = 1,
  phoneNumberProvided: boolean | null = null,
  endpoint: InsightsEndpoint = "fullSearchByAttribute"
) {
  const minDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const filters: Record<string, unknown> = {
    contractTypeID: 1,
    categoryTypeID: 1,
    propertyTypeID: null,
    propertyQualityID: null,
    boundingBox: NMRE_BOUNDING_BOX,
    marketZoneID: null,
    omiZoneID: null,
    municipalityID: null,
    minRooms: null,
    maxRooms: null,
    minBathrooms: null,
    maxBathrooms: null,
    elevator: null,
    garage: null,
    maintenanceStatusID: null,
    pubblicationStatusID: [1, 2],
    minGrossSquareFootage: null,
    maxGrossSquareFootage: null,
    unitFloor: null,
    minPrice: null,
    maxPrice: null,
    minDate: formatInsightsDate(minDate),
    maxDate: formatInsightsDate(now),
    clientTypeID,
    phoneNumberProvided
  };
  if (endpoint === "searchByAttribute") filters.comparableTypeID = 1;
  return {
    Filters: filters,
    Pagination: { page, limit: INSIGHTS_PAGE_LIMIT },
    Sorting: { by: "date", direction: "desc" }
  };
}

/** Date delle risposte: "DD/MM/YYYYT00:00:00Z", "DD/MM/YYYY" o ISO. */
export function parseApiDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const italian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:T(\d{2}):(\d{2}):(\d{2})Z?)?$/);
  const parsed = italian
    ? new Date(Date.UTC(
        Number(italian[3]),
        Number(italian[2]) - 1,
        Number(italian[1]),
        Number(italian[4] || 0),
        Number(italian[5] || 0),
        Number(italian[6] || 0)
      ))
    : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Chiave dell'immobile NMRE (stesso formato della sincronizzazione Gmail): immobiliare.it/annunci/<id>. */
export function immobiliareListingKey(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || host !== "immobiliare.it") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2 || segments[0].toLowerCase() !== "annunci") return null;
    if (!/^[0-9]{5,}$/.test(segments[1])) return null;
    return "immobiliare.it/annunci/" + segments[1];
  } catch {
    return null;
  }
}
/** ID dell'annuncio sul portale (usabile con GET /comparable/id/<id>, solo dati Asking). */
export function immobiliareListingId(value: unknown): string | null {
  const key = immobiliareListingKey(value);
  return key ? key.split("/").pop()! : null;
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}
// deno-lint-ignore no-explicit-any
function stringList(value: any, max: number): string[] {
  return Array.isArray(value) ? value.filter((entry: unknown) => typeof entry === "string" && entry.trim()).slice(0, max) : [];
}
// deno-lint-ignore no-explicit-any
function httpsImages(value: any): string[] {
  return stringList(value, 30).filter(url => /^https:\/\//i.test(url));
}

/** Tipo di inserzionista dichiarato nella risposta ("Privato", "Professionista" o null). */
// deno-lint-ignore no-explicit-any
export function declaredClientType(item: Record<string, any>): "Privato" | "Professionista" | null {
  const raw = normalizeMunicipality(item?.clientType);
  if (["privato", "private", "1"].includes(raw)) return "Privato";
  if (["professionista", "professional", "agenzia", "agency", "2"].includes(raw)) return "Professionista";
  return null;
}

export type CandidateContext = {
  ownerId: string;
  /** clientTypeID della ricerca che ha restituito l'annuncio. */
  clientTypeID: 1 | 2;
  /** true se l'annuncio è restituito anche dalla ricerca con phoneNumberProvided=true. */
  phoneFlag: boolean | null;
  requestId?: string | null;
  nowIso?: string;
};

/**
 * Candidato NMRE da un risultato di fullSearchByAttribute o di Comparable Detail
 * (stessa struttura). null se fuori area, senza link o UUID, o se il tipo di
 * inserzionista dichiarato contraddice la ricerca. Il numero di telefono non è mai
 * presente nell'output documentato: "contatto" resta vuoto.
 */
// deno-lint-ignore no-explicit-any
export function toCandidate(item: Record<string, any>, context: CandidateContext) {
  const location = item?.location ?? {};
  const comune = typeof location.municipality === "string" ? location.municipality.trim() : "";
  if (!isAllowedMunicipality(comune)) return null;

  const listingKey = immobiliareListingKey(item?.listingUrl);
  const uuid = typeof item?.uuid === "string" ? item.uuid.trim() : "";
  if (!listingKey || !uuid) return null;
  if (context.clientTypeID !== 1 && context.clientTypeID !== 2) return null;

  const declared = declaredClientType(item);
  if (context.clientTypeID === 1 && declared === "Professionista") return null;
  if (context.clientTypeID === 2 && declared === "Privato") return null;

  const features = item?.features ?? {};
  const propertyType = typeof item?.propertyType === "string" ? item.propertyType.trim() : "";
  const rawTitle = text(item?.extra?.title, 250);
  const title = (rawTitle || (propertyType ? propertyType + " a " + comune : "Immobile a " + comune)).slice(0, 250);
  const rawPrice = safeNumber(item?.value?.askingPrice ?? item?.askingPrice);
  const rawSurface = safeNumber(item?.grossSquareFootage);
  const rawRooms = safeNumber(item?.rooms);
  const rawBathrooms = safeNumber(features.numberOfBathrooms ?? item?.numberOfBathrooms);
  const listingUrl = "https://www." + listingKey + "/";
  const seller = context.clientTypeID === 1 ? "Privato" : "Agenzia";
  const phoneText = context.phoneFlag === true
    ? " Restituito anche dalla ricerca con il filtro phoneNumberProvided=true: il significato del filtro non è descritto dalla documentazione e l'API non restituisce alcun numero; il recapito va verificato aprendo l'annuncio."
    : " L'API non restituisce numeri di telefono: il recapito va verificato aprendo l'annuncio.";
  const sellerEvidence = context.clientTypeID === 1
    ? "Immobiliare.it Insights: ricerca ufficiale clientTypeID=1 (Privato)" + (declared === "Privato" ? ", clientType «Privato» nella risposta." : ".") + phoneText
    : "Immobiliare.it Insights: ricerca ufficiale clientTypeID=2 (Professionista).";
  const surface = rawSurface !== null && Number.isInteger(rawSurface) && rawSurface >= 1 && rawSurface <= 100000 ? rawSurface : null;
  const rooms = rawRooms !== null && rawRooms >= 0.5 && rawRooms <= 100 ? rawRooms : null;
  const bathrooms = rawBathrooms !== null && Number.isInteger(rawBathrooms) && rawBathrooms >= 0 && rawBathrooms <= 100 ? rawBathrooms : null;
  const price = rawPrice !== null && rawPrice >= 0 ? Math.round(rawPrice) : null;

  return {
    owner_id: context.ownerId,
    titolo: title,
    comune: comune.slice(0, 150),
    prezzo: price,
    contatto: null,
    tipo_venditore: seller,
    seller_confidence: 99,
    seller_evidence: sellerEvidence,
    seller_classification_version: 4,
    seller_manual_override: false,
    portale: "Immobiliare.it",
    url: listingUrl,
    url_originale: listingUrl,
    // collectionDate = data di creazione dell'annuncio (Mapping of output data);
    // lastUpdateDate per gli annunci in offerta è la data di rimozione.
    data_pubblicazione: parseApiDate(item?.collectionDate),
    notification_sender: null,
    email_subject: null,
    source_email_id: null,
    dedup_key: "insights:immobiliare:" + uuid,
    listing_key: listingKey,
    stato: "da_verificare",
    tipologia_immobile: propertyType.slice(0, 80) || null,
    superficie_mq: surface,
    locali: rooms,
    camere: null,
    bagni: bathrooms,
    dati_estratti: {
      campi_immobile: { titolo: title, comune, prezzo: price, tipologia: propertyType || null, superficie_mq: surface, locali: rooms, bagni: bathrooms },
      insights: {
        uuid,
        listing_id: listingKey.split("/").pop(),
        descrizione: text(features.description, 6000),
        immagini: httpsImages(item?.attachments?.image),
        immagine_copertina: text(item?.attachments?.coverImage ?? item?.coverImage, 500),
        planimetria: text(item?.attachments?.layout, 500),
        classe_energetica: text(features.energyClass ?? item?.energyClass, 60),
        piano: features.unitFloor ?? item?.unitFloor ?? null,
        piani_edificio: safeNumber(features.numberOfBuildingFloor ?? item?.numberOfBuildingFloor),
        ascensore: typeof (features.elevator ?? item?.elevator) === "boolean" ? (features.elevator ?? item?.elevator) : null,
        stato_immobile: text(features.maintenanceStatus ?? item?.maintenanceStatus, 80),
        riscaldamento: text(features.heatingSystem ?? item?.heatingsystem, 80),
        anno_costruzione: safeNumber(features.constructionYear),
        occupazione: text(features.occupancyStatus, 60),
        caratteristiche: stringList(features.facilityList, 40),
        spese_condominiali: safeNumber(item?.extra?.condoFees),
        superfici: Array.isArray(item?.unitGrossSquareFootage) ? item.unitGrossSquareFootage.slice(0, 20) : [],
        stato_pubblicazione: text(item?.pubblicationStatus, 40),
        tipo_inserzionista_dichiarato: declared,
        ricerca_client_type_id: context.clientTypeID,
        // true = restituito anche dalla ricerca con phoneNumberProvided=true; null = non noto.
        // Non è un numero di telefono e non indica quale recapito.
        filtro_recapito_segnalato: context.phoneFlag,
        data_creazione: parseApiDate(item?.collectionDate),
        data_rimozione: parseApiDate(item?.lastUpdateDate),
        indirizzo: text(location.address, 200),
        civico: text(location.streetNumber, 20),
        cap: text(location.zipCode, 10),
        zona: text(location.marketZone, 120),
        provincia: text(location.province, 80),
        latitudine: safeNumber(location.latitude),
        longitudine: safeNumber(location.longitude),
        id_comune_insights: safeNumber(location.municipalityID ?? item?.municipalityID),
        duplicati: item?.duplicates ?? null,
        duplicato_principale: typeof item?.duplicatesParent === "boolean" ? item.duplicatesParent : null,
        fonte: text(item?.sourceName, 60)
      }
    },
    dati_fonte: {
      provider: "Immobiliare.it Insights",
      endpoint: "fullSearchByAttribute",
      uuid,
      request_id: context.requestId ?? null,
      captured_at: context.nowIso ?? new Date().toISOString()
    }
  };
}

export type InsightsCandidate = NonNullable<ReturnType<typeof toCandidate>>;
