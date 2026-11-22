export const ALLOWED_MUNICIPALITIES = [
  "Castelfidardo", "Ancona", "Osimo", "Loreto", "Recanati", "Camerano",
  "Numana", "Sirolo", "Jesi", "Macerata", "Fermo", "Senigallia",
  "Filottrano", "Polverigi", "Agugliano", "Offagna", "Chiaravalle",
  "Ostra", "Tolentino", "Staffolo", "Cupramontana", "Monsano",
  "Trecastelli", "Corridonia", "Montegranaro", "Porto Sant'Elpidio",
  "Porto Recanati", "Porto San Giorgio", "Civitanova Marche",
  "Falconara Marittima", "Santa Maria Nuova", "Maiolati Spontini",
  "Monte San Vito", "Monte Urano", "Monte Roberto", "Montecassiano",
  "Morro d'Alba", "Montemarciano"
];

function normalize(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function resolveMunicipality(value: unknown): string | null {
  const source = normalize(value);
  if (!source) return null;
  return ALLOWED_MUNICIPALITIES.find((town) => {
    const normalizedTown = normalize(town);
    return source === normalizedTown || source.startsWith(normalizedTown + " ") ||
      source.includes(" " + normalizedTown + " ");
  }) ?? null;
}

function numberValue(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function officialListingUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || host !== "idealista.it" || !url.pathname.includes("/immobile/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sellerType(item: Record<string, any>): "Privato" | "Agenzia" | "Da verificare" {
  // Idealista Search API documentation is issued privately. Only explicit metadata is trusted here.
  const metadata = normalize([
    item.contactType, item.advertiserType, item.sellerType, item.clientType,
    item.advertiserKind, item.contactKind
  ].filter((value) => typeof value === "string").join(" "));
  if (/\b(privato|particular|owner|proprietario)\b/.test(metadata)) return "Privato";
  if (/\b(agenzia|agency|professional|professionista|agent)\b/.test(metadata)) return "Agenzia";
  return "Da verificare";
}

export function toIdealistaCandidate(item: Record<string, any>, ownerId: string) {
  const comune = resolveMunicipality(item.municipality ?? item.city ?? item.location?.municipality);
  const id = String(item.propertyCode ?? item.propertyId ?? item.adId ?? item.id ?? "").trim();
  const url = officialListingUrl(item.url ?? item.detailUrl ?? item.listingUrl);
  if (!comune || !id || !url) return null;

  const propertyType = typeof item.propertyType === "string" ? item.propertyType.trim() : "";
  const suggested = item.suggestedTexts ?? {};
  const title = String(suggested.title ?? item.title ?? (propertyType ? propertyType + " a " + comune : "Immobile a " + comune)).trim().slice(0, 250);
  const price = numberValue(item.price);
  const surface = numberValue(item.size ?? item.surface);
  const rooms = numberValue(item.rooms);
  const bedrooms = numberValue(item.bedrooms);
  const bathrooms = numberValue(item.bathrooms);
  const seller = sellerType(item);
  if (seller === "Agenzia") return null;

  return {
    owner_id: ownerId,
    titolo: title || "Immobile a " + comune,
    comune,
    prezzo: price !== null && price >= 0 ? Math.round(price) : null,
    contatto: null,
    tipo_venditore: seller,
    portale: "Idealista",
    url,
    data_pubblicazione: dateValue(item.publicationDate ?? item.creationDate ?? item.date),
    notification_sender: null,
    email_subject: null,
    source_email_id: null,
    dedup_key: "idealista:" + id,
    stato: "da_verificare",
    tipologia_immobile: propertyType.slice(0, 80) || null,
    superficie_mq: surface !== null && Number.isInteger(surface) && surface >= 1 && surface <= 100000 ? surface : null,
    locali: rooms !== null && rooms >= 0.5 && rooms <= 100 ? rooms : null,
    camere: bedrooms !== null && Number.isInteger(bedrooms) && bedrooms >= 0 && bedrooms <= 100 ? bedrooms : null,
    bagni: bathrooms !== null && Number.isInteger(bathrooms) && bathrooms >= 0 && bathrooms <= 100 ? bathrooms : null
  };
}

export function idealistaSearchForm(page: number, center: string, distance: number) {
  const form = new FormData();
  form.set("center", center);
  form.set("distance", String(distance));
  form.set("propertyType", "homes");
  form.set("operation", "sale");
  form.set("maxItems", "50");
  form.set("numPage", String(page));
  form.set("sinceDate", "M");
  form.set("locale", "it");
  return form;
}
