import type { CandidateRecordStatus } from "@/shared/data/candidateRepository";

export type CandidateBadgeTone = "success" | "warning" | "neutral";

export interface CandidateSellerPresentation {
  label: string;
  tone: CandidateBadgeTone;
}

export function candidateStatusLabel(status: CandidateRecordStatus): string {
  switch (status) {
    case "da_verificare": return "Da verificare";
    case "confermato": return "Confermato";
    case "scartato": return "Scartato";
    default: return "Stato non riconosciuto";
  }
}

export function candidateSellerPresentation(
  sellerType: string | null,
  status: CandidateRecordStatus
): CandidateSellerPresentation {
  const normalized = sellerType?.trim().toLocaleLowerCase("it-IT") ?? "";

  if (normalized === "privato") {
    if (status === "confermato") return { label: "Privato confermato", tone: "success" };
    if (status === "scartato") return { label: "Privato · scartato", tone: "neutral" };
    return { label: "Privato da verificare", tone: "warning" };
  }

  if (normalized === "agenzia") return { label: "Agenzia", tone: "neutral" };
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
