import type { CandidateRecordStatus } from "@/shared/data/candidateRepository";

export type CandidateBadgeTone = "success" | "warning" | "neutral";

export interface CandidateSellerPresentation {
  label: string;
  tone: CandidateBadgeTone;
}

export interface CandidateSellerEvidence {
  sellerType: string | null;
  status: CandidateRecordStatus;
  manualOverride: boolean;
  confidence: number | null;
  evidence: string | null;
}

export function candidateStatusLabel(status: CandidateRecordStatus): string {
  switch (status) {
    case "da_verificare": return "Da verificare";
    case "confermato": return "Confermato";
    case "scartato": return "Scartato";
    default: return "Stato non riconosciuto";
  }
}

/**
 * A private seller is confirmed only by the explicit manual-verification
 * evidence written by the existing NMRE workflow. Candidate workflow status
 * alone does not certify seller identity.
 */
export function candidateSellerPresentation(input: CandidateSellerEvidence): CandidateSellerPresentation {
  const sellerType = input.sellerType?.trim().toLocaleLowerCase("it-IT") ?? "";
  const evidence = input.evidence?.trim().toLocaleLowerCase("it-IT") ?? "";
  const manuallyVerifiedPrivate =
    sellerType === "privato" &&
    input.manualOverride &&
    input.confidence !== null &&
    input.confidence >= 100 &&
    evidence.startsWith("verificato manualmente: venditore privato");

  if (manuallyVerifiedPrivate) return { label: "Privato confermato", tone: "success" };
  if (sellerType === "privato") return { label: "Privato da verificare", tone: "warning" };
  if (sellerType === "agenzia") return { label: "Agenzia", tone: "neutral" };
  return { label: "Venditore da verificare", tone: "warning" };
}

export function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function formatCandidatePrice(value: number | null): string {
  if (value === null || value < 0) return "Prezzo non indicato";
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatCandidateDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}
