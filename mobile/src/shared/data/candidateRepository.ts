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
