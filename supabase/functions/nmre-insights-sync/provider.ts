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
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("it");
}

export function formatInsightsDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return day + "/" + month + "/" + date.getUTCFullYear() + "T00:00:00Z";
}

export function buildInsightsSearchPayload(now: Date, lookbackDays = 30, page = 1) {
  const minDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return {
    Filters: {
      contractTypeID: 1,
      categoryTypeID: null,
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
      clientTypeID: 1,
      phoneNumberProvided: true
    },
    Pagination: { page, limit: 10 },
    Sorting: { by: "date", direction: "desc" }
  };
}

function parseApiDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const italian = text.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})(?:T(\\d{2}):(\\d{2}):(\\d{2})Z?)?$/);
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

export function toCandidate(item: Record<string, any>, ownerId: string) {
  // Full Search by Attribute returns expanded "Offerta" details. The search payload
  // explicitly filters clientTypeID=1 (Privato) and phoneNumberProvided=true.
  const location = item?.location ?? {};
  const comune = typeof location.municipality === "string" ? location.municipality.trim() : "";
  if (!ALLOWED_MUNICIPALITIES.has(normalize(comune))) return null;

  const url = validListingUrl(item.listingUrl);
  const uuid = typeof item.uuid === "string" ? item.uuid.trim() : "";
  if (!url || !uuid) return null;

  // Respect a future explicit classification field should the provider expose one.
  if (normalize(item.clientType) === "professionista") return null;

  const propertyType = typeof item.propertyType === "string" ? item.propertyType.trim() : "";
  const rawTitle = typeof item.extra?.title === "string" ? item.extra.title.trim() : "";
  const title = (rawTitle || (propertyType ? propertyType + " a " + comune : "Immobile a " + comune)).slice(0, 250);
  const rawPrice = safeNumber(item.value?.askingPrice ?? item.askingPrice);
  const rawSurface = safeNumber(item.grossSquareFootage);
  const rawRooms = safeNumber(item.rooms);
  const rawBathrooms = safeNumber(item.features?.numberOfBathrooms ?? item.numberOfBathrooms);
  const rawClientType = normalize(item.clientType);
  const seller = rawClientType === "privato" || !rawClientType ? "Privato" : "Da verificare";

  return {
    owner_id: ownerId,
    titolo: title,
    comune: comune.slice(0, 150),
    prezzo: rawPrice !== null && rawPrice >= 0 ? Math.round(rawPrice) : null,
    contatto: null,
    tipo_venditore: seller,
    portale: "Immobiliare.it",
    url,
    data_pubblicazione: parseApiDate(item.collectionDate ?? item.lastUpdateDate),
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
