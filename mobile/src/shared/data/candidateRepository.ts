import { supabase } from "@/shared/supabase/client";

export type CandidateStatusFilter = "da_verificare" | "confermato" | "scartato" | "tutti";
export type CandidateRecordStatus = "da_verificare" | "confermato" | "scartato" | "unknown";

export interface CandidateSummary {
  id: string;
  title: string | null;
  municipality: string | null;
  price: number | null;
  sellerType: string | null;
  portal: string | null;
  listingUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  status: CandidateRecordStatus;
  linkedListingId: string | null;
  propertyType: string | null;
  surfaceSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sellerConfidence: number | null;
  sellerEvidence: string | null;
  sellerManualOverride: boolean;
}

export interface CandidatePage {
  items: CandidateSummary[];
  total: number;
}

export const CANDIDATE_PAGE_SIZE = 25;

// Excludes direct contact, email metadata and raw source/extraction JSON.
const CANDIDATE_SELECT = [
  "id", "titolo", "comune", "prezzo", "tipo_venditore", "portale",
  "url", "url_originale", "data_pubblicazione", "created_at", "stato",
  "annuncio_id", "tipologia_immobile", "superficie_mq", "locali",
  "camere", "bagni", "seller_confidence", "seller_evidence",
  "seller_manual_override"
].join(",");

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function candidateStatus(value: unknown): CandidateRecordStatus {
  if (value === "da_verificare" || value === "confermato" || value === "scartato") return value;
  return "unknown";
}

function mapCandidate(row: Record<string, unknown>): CandidateSummary {
  return {
    id: String(row.id),
    title: nullableText(row.titolo),
    municipality: nullableText(row.comune),
    price: nullableNumber(row.prezzo),
    sellerType: nullableText(row.tipo_venditore),
    portal: nullableText(row.portale),
    listingUrl: nullableText(row.url) ?? nullableText(row.url_originale),
    publishedAt: nullableText(row.data_pubblicazione),
    createdAt: String(row.created_at),
    status: candidateStatus(row.stato),
    linkedListingId: nullableText(row.annuncio_id),
    propertyType: nullableText(row.tipologia_immobile),
    surfaceSqm: nullableNumber(row.superficie_mq),
    rooms: nullableNumber(row.locali),
    bedrooms: nullableNumber(row.camere),
    bathrooms: nullableNumber(row.bagni),
    sellerConfidence: nullableNumber(row.seller_confidence),
    sellerEvidence: nullableText(row.seller_evidence),
    sellerManualOverride: row.seller_manual_override === true
  };
}

/** Read-only, paginated query. RLS remains the authorization boundary. */
export async function loadCandidatePage(
  ownerId: string,
  statusFilter: CandidateStatusFilter,
  municipality: string,
  offset: number,
  pageSize = CANDIDATE_PAGE_SIZE
): Promise<CandidatePage> {
  if (!ownerId) throw new Error("Sessione utente non disponibile.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new Error("Parametri di paginazione non validi.");
  }

  let query = supabase
    .from("annunci_candidati")
    .select(CANDIDATE_SELECT, { count: "exact" })
    .eq("owner_id", ownerId);

  if (statusFilter === "da_verificare") {
    query = query.eq("stato", "da_verificare").is("annuncio_id", null);
  } else if (statusFilter === "confermato") {
    query = query.eq("stato", "confermato");
  } else if (statusFilter === "scartato") {
    query = query.eq("stato", "scartato");
  }

  const cleanedMunicipality = municipality.trim();
  if (cleanedMunicipality) {
    query = query.ilike("comune", "%" + cleanedMunicipality + "%");
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + pageSize - 1);

  if (error) {
    throw new Error("Non è stato possibile caricare le opportunità. Verifichi la connessione e riprovi.");
  }

  // The project does not yet ship generated Database types. Keep the untyped
  // PostgREST boundary explicit, then map each selected row into our domain model.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const items = rows.map(mapCandidate);
  return { items, total: count ?? items.length };
}


export interface CandidateArchiveResult {
  listingId: string;
  enriched: boolean;
  enrichmentWarning: string | null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeCandidateHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function enrichmentUrl(value: string | null): string | null {
  const safeUrl = safeCandidateHttpsUrl(value);
  if (!safeUrl) return null;
  try {
    const parsed = new URL(safeUrl);
    if (parsed.port && parsed.port !== "443") return null;
    const host = parsed.hostname.toLowerCase();
    const allowed = [
      "immobiliare.it",
      "idealista.it",
      "casa.it",
      "wikicasa.it",
      "subito.it",
      "casa.trovit.it"
    ];
    return allowed.some(domain => host === domain || host.endsWith("." + domain))
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function suggestedText(suggestions: Record<string, unknown>, key: string): string | null {
  return nullableText(suggestions[key]);
}

function suggestedNumber(suggestions: Record<string, unknown>, key: string): number | null {
  return nullableNumber(suggestions[key]);
}

function nonNegativeNumber(value: number | null): number | null {
  return value !== null && value >= 0 ? value : null;
}

function validInteger(value: number | null, minimum: number, maximum: number): number | null {
  return value !== null && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

/** Marks only the selected owner's pending candidate as discarded; it never deletes the row. */
export async function discardCandidate(ownerId: string, candidateId: string): Promise<void> {
  if (!ownerId) throw new Error("Sessione utente non disponibile.");
  if (!candidateId) throw new Error("Opportunità non valida.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");

  const { data, error } = await supabase
    .from("annunci_candidati")
    .update({ stato: "scartato", updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("id", candidateId)
    .eq("stato", "da_verificare")
    .is("annuncio_id", null)
    .select("id")
    .maybeSingle();

  if (error) throw new Error("Impossibile scartare l'opportunità. Verifichi la connessione e riprovi.");
  if (!data) throw new Error("L'opportunità non è più in attesa di verifica. Aggiorni la lista.");
}

/**
 * Attempts the same public-page enrichment as the web client, then calls the
 * existing owner-checked database RPC. The RPC creates the archived listing
 * and links it back to the candidate in one transaction.
 */
export async function archiveCandidate(
  ownerId: string,
  candidate: CandidateSummary
): Promise<CandidateArchiveResult> {
  if (!ownerId) throw new Error("Sessione utente non disponibile.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");
  if (candidate.status !== "da_verificare" || candidate.linkedListingId) {
    throw new Error("Questa opportunità non è più archiviabile. Aggiorni la lista.");
  }

  const { data: sourceRecord, error: sourceError } = await supabase
    .from("annunci_candidati")
    .select("contatto,dati_estratti")
    .eq("owner_id", ownerId)
    .eq("id", candidate.id)
    .eq("stato", "da_verificare")
    .is("annuncio_id", null)
    .maybeSingle();

  if (sourceError || !sourceRecord) {
    throw new Error("Non è stato possibile rileggere i dati originali dell'opportunità.");
  }

  const source = sourceRecord as unknown as Record<string, unknown>;
  const sourceUrl = safeCandidateHttpsUrl(candidate.listingUrl);
  let finalUrl = sourceUrl;
  let title = candidate.title?.trim() ?? "";
  let municipality = candidate.municipality?.trim() ?? "";
  let price = candidate.price;
  let propertyType = candidate.propertyType;
  let surfaceSqm = candidate.surfaceSqm;
  let rooms = candidate.rooms;
  let bedrooms = candidate.bedrooms;
  let bathrooms = candidate.bathrooms;
  let enriched = false;
  let enrichmentWarning: string | null = null;

  const publicPageUrl = enrichmentUrl(sourceUrl);
  if (sourceUrl && !publicPageUrl) {
    enrichmentWarning = "L'analisi automatica non è disponibile per questo portale. Saranno conservati i dati già raccolti.";
  } else if (publicPageUrl) {
    let enrichmentData: Record<string, unknown> | null = null;
    try {
      const response = await supabase.functions.invoke("nmre-candidate-enrich", {
        body: { url: publicPageUrl }
      });
      if (response.error) throw new Error(response.error.message);
      const payload = objectValue(response.data);
      if (payload.success !== true) {
        throw new Error(nullableText(payload.error) ?? "La pagina non ha restituito dati leggibili.");
      }
      enrichmentData = payload;
    } catch (error) {
      enrichmentWarning = error instanceof Error
        ? error.message
        : "Non è stato possibile recuperare altri dati pubblici.";
    }

    if (enrichmentData) {
      const suggestions = objectValue(enrichmentData.suggestions);
      const suggestedTitle = suggestedText(suggestions, "titolo");
      const suggestedMunicipality = suggestedText(suggestions, "comune");

      if (!title || title.toLocaleLowerCase("it-IT") === "annuncio immobiliare") {
        title = suggestedTitle ?? title;
      }
      if (!municipality) municipality = suggestedMunicipality ?? municipality;
      if (price === null) price = suggestedNumber(suggestions, "prezzo");
      if (!propertyType) propertyType = suggestedText(suggestions, "tipologia_immobile");
      if (surfaceSqm === null) surfaceSqm = suggestedNumber(suggestions, "superficie_mq");
      if (rooms === null) rooms = suggestedNumber(suggestions, "locali");
      if (bedrooms === null) bedrooms = suggestedNumber(suggestions, "camere");
      if (bathrooms === null) bathrooms = suggestedNumber(suggestions, "bagni");

      const returnedUrl = safeCandidateHttpsUrl(nullableText(enrichmentData.final_url));
      finalUrl = returnedUrl ?? publicPageUrl;
      const extracted = objectValue(source.dati_estratti);
      const existingPage = objectValue(extracted.pagina_pubblica);
      const nextExtracted = {
        ...extracted,
        pagina_pubblica: {
          ...existingPage,
          url_originale: sourceUrl,
          url_finale: finalUrl,
          portale: candidate.portal,
          recuperato_il: nullableText(enrichmentData.retrieved_at) ?? new Date().toISOString(),
          evidenza: nullableText(enrichmentData.evidence) ?? "Metadati pubblici della pagina",
          suggestions
        }
      };

      // Extraction JSON is read only for this explicit action and is never rendered.
      const updates: Record<string, unknown> = {
        titolo: title || null,
        comune: municipality || null,
        prezzo: nonNegativeNumber(price),
        tipologia_immobile: propertyType,
        superficie_mq: validInteger(surfaceSqm, 1, 100000),
        locali: rooms !== null && rooms >= 0.5 && rooms <= 100 ? rooms : null,
        camere: validInteger(bedrooms, 0, 100),
        bagni: validInteger(bathrooms, 0, 100),
        url: finalUrl,
        url_originale: sourceUrl,
        dati_estratti: nextExtracted,
        data_extraction_version: 2,
        updated_at: new Date().toISOString()
      };
      const { data: saved, error: saveError } = await supabase
        .from("annunci_candidati")
        .update(updates as never)
        .eq("owner_id", ownerId)
        .eq("id", candidate.id)
        .eq("stato", "da_verificare")
        .is("annuncio_id", null)
        .select("id")
        .maybeSingle();

      if (saveError || !saved) {
        throw new Error("I dati aggiuntivi sono stati rilevati ma non è stato possibile salvarli. L'annuncio non è stato archiviato.");
      }
      enriched = true;
    }
  } else {
    enrichmentWarning = "Non è presente un link HTTPS valido per recuperare altri dati. Saranno conservati i dati già raccolti.";
  }

  if (!title || !municipality) {
    throw new Error("Per archiviare servono almeno il titolo e il comune. L'annuncio non è stato spostato.");
  }

  const sellerType = candidate.sellerType === "Privato" || candidate.sellerType === "Agenzia"
    ? candidate.sellerType
    : "Da verificare";
  const surfaceValue = validInteger(surfaceSqm, 1, 100000);
  const roomsValue = rooms !== null && rooms >= 0.5 && rooms <= 100 ? rooms : null;
  const bedroomsValue = validInteger(bedrooms, 0, 100);
  const bathroomsValue = validInteger(bathrooms, 0, 100);

  const { data: listingId, error: archiveError } = await supabase.rpc(
    "nmre_confirm_annuncio_candidato",
    {
      p_candidate_id: candidate.id,
      p_titolo: title,
      p_comune: municipality,
      p_prezzo: nonNegativeNumber(price),
      p_contatto: nullableText(source.contatto),
      p_tipo_venditore: sellerType,
      p_portale: candidate.portal,
      p_url: finalUrl ?? sourceUrl,
      p_tipologia_immobile: propertyType,
      p_superficie_mq: surfaceValue,
      p_locali: roomsValue,
      p_camere: bedroomsValue,
      p_bagni: bathroomsValue
    }
  );

  if (archiveError) {
    throw new Error("Impossibile archiviare l'annuncio. Verifichi che sia ancora da verificare e riprovi.");
  }
  if (typeof listingId !== "string" || !listingId) {
    throw new Error("Il gestionale non ha restituito il riferimento del nuovo annuncio.");
  }

  return { listingId, enriched, enrichmentWarning };
}
