import { TARGET_MUNICIPALITIES, normalizeMunicipality } from "../_shared/territory.ts";

export const ALLOWED_MUNICIPALITIES = TARGET_MUNICIPALITIES;

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

function normalize(value: unknown): string {
  return normalizeMunicipality(value);
}

export function formatInsightsDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return day + "/" + month + "/" + date.getUTCFullYear() + "T00:00:00Z";
}

export function buildInsightsSearchPayload(
  now: Date,
  lookbackDays = 30,
  page = 1,
  clientTypeID: 1 | 2 = 1,
  phoneNumberProvided: boolean | null = true
) {
  const minDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return {
    Filters: {
      comparableTypeID: 1,
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
    },
    Pagination: { page, limit: 5 },
    Sorting: { by: "date", direction: "desc" }
  };
}

function parseApiDate(value: unknown): string | null {
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

function validListingUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || !(host === "immobiliare.it" || host.endsWith(".immobiliare.it"))) return null;
    if (!url.pathname.includes("/annunci/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toCandidate(
  item: Record<string, any>,
  ownerId: string,
  clientTypeID: 1 | 2 = 1,
  phoneNumberProvided: boolean | null = true
) {
  // The official Search by Attribute request filters clientTypeID:
  // 1 = Privato, 2 = Professionista. Do not infer seller type from missing text.
  const location = item?.location ?? {};
  const comune = typeof location.municipality === "string" ? location.municipality.trim() : "";
  if (!ALLOWED_MUNICIPALITIES.has(normalize(comune))) return null;

  const url = validListingUrl(item.listingUrl);
  const uuid = typeof item.uuid === "string" ? item.uuid.trim() : "";
  if (!url || !uuid) return null;

  if (clientTypeID !== 1 && clientTypeID !== 2) return null;

  const rawClientType = normalize(item.clientType);
  const privateLabels = new Set(["privato", "private", "private owner", "1"]);
  const professionalLabels = new Set(["professionista", "professional", "agency", "agenzia", "2"]);
  if (clientTypeID === 1 && professionalLabels.has(rawClientType)) return null;
  if (clientTypeID === 2 && privateLabels.has(rawClientType)) return null;

  const propertyType = typeof item.propertyType === "string" ? item.propertyType.trim() : "";
  const rawTitle = typeof item.extra?.title === "string" ? item.extra.title.trim() : "";
  const title = (rawTitle || (propertyType ? propertyType + " a " + comune : "Immobile a " + comune)).slice(0, 250);
  const rawPrice = safeNumber(item.value?.askingPrice ?? item.askingPrice);
  const rawSurface = safeNumber(item.grossSquareFootage);
  const rawRooms = safeNumber(item.rooms);
  const rawBathrooms = safeNumber(item.features?.numberOfBathrooms ?? item.numberOfBathrooms);
  const seller = clientTypeID === 1 ? "Privato" : "Agenzia";
  const sellerEvidence = clientTypeID === 1
    ? (phoneNumberProvided === true
      ? "Immobiliare.it Insights: clientTypeID=1 (Privato); filtro phoneNumberProvided=true. Il portale segnala un recapito nell’annuncio, ma l’API non restituisce il numero: verifica manuale necessaria."
      : "Immobiliare.it Insights: clientTypeID=1 (Privato); indicatore di recapito non verificato. L’API non restituisce il numero.")
    : "Immobiliare.it Insights: filtro ufficiale clientTypeID=2 (Professionista)";

  return {
    owner_id: ownerId,
    titolo: title,
    comune: comune.slice(0, 150),
    prezzo: rawPrice !== null && rawPrice >= 0 ? Math.round(rawPrice) : null,
    contatto: null,
    tipo_venditore: seller,
    seller_confidence: 99,
    seller_evidence: sellerEvidence,
    seller_classification_version: 4,
    seller_manual_override: false,
    portale: "Immobiliare.it",
    url,
    url_originale: url,
    // collectionDate è la data di creazione dell'annuncio; lastUpdateDate per gli annunci
    // in offerta indica invece la data di rimozione e non va mostrata come pubblicazione.
    data_pubblicazione: parseApiDate(item.collectionDate),
    notification_sender: null,
    email_subject: null,
    source_email_id: null,
    dedup_key: "insights:immobiliare:" + uuid,
    stato: "da_verificare",
    tipologia_immobile: propertyType.slice(0, 80) || null,
    superficie_mq: rawSurface !== null && Number.isInteger(rawSurface) && rawSurface >= 1 && rawSurface <= 100000 ? rawSurface : null,
    locali: rawRooms !== null && rawRooms >= 0.5 && rawRooms <= 100 ? rawRooms : null,
    camere: null,
    bagni: rawBathrooms !== null && Number.isInteger(rawBathrooms) && rawBathrooms >= 0 && rawBathrooms <= 100 ? rawBathrooms : null
  };
}
