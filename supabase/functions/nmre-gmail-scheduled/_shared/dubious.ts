// Rete di sicurezza del filtro avvisi (Fase 2 · avvisi dubbi).
//
// Non cambia le regole del filtro né del classificatore: le email escluse dal
// filtro che mostrano una prova oggettiva di riferirsi a un annuncio vengono
// conservate come "avvisi dubbi" in una sezione separata, con il riferimento
// all'email originale e senza il testo del messaggio.
import type { PropertyEmailRule } from "./parser.ts";

export type DubiousAlertEvidence = {
  portal: string | null;
  listingUrl: string | null;
  reason: "scheda_specifica" | "mittente_portale";
};

/** Dominio del mittente, dall'intestazione From ("Nome <utente@dominio>"). */
export function senderDomain(from: unknown): string | null {
  const value = String(from ?? "");
  const match = value.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*>?\s*$/) || value.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  return match ? match[1].toLowerCase() : null;
}

export function portalForHost(host: string | null, portals: string[]): string | null {
  if (!host) return null;
  const clean = host.toLowerCase().replace(/^www\./, "");
  return portals.find(domain => clean === domain || clean.endsWith("." + domain)) || null;
}

/**
 * Decide se un'email esclusa dal filtro va conservata come avviso dubbio.
 * Prove ammesse (deterministiche, documentate):
 *  - una scheda specifica di un portale riconosciuto nel testo, oppure
 *  - il mittente appartiene a un portale riconosciuto.
 * Le esclusioni nell'oggetto (benvenuto, password, verifica account…) richiedono
 * la scheda specifica: il solo mittente del portale non basta.
 */
export function dubiousAlertEvidence(
  rule: PropertyEmailRule,
  email: { from?: unknown },
  specificListingUrl: string | null,
  portals: string[]
): DubiousAlertEvidence | null {
  if (rule === "accettata") return null;
  let listingPortal: string | null = null;
  if (specificListingUrl) {
    try { listingPortal = portalForHost(new URL(specificListingUrl).hostname, portals); } catch { listingPortal = null; }
  }
  if (specificListingUrl && listingPortal) {
    return { portal: listingPortal, listingUrl: specificListingUrl, reason: "scheda_specifica" };
  }
  if (rule === "esclusione_nell_oggetto") return null;
  const senderPortal = portalForHost(senderDomain(email.from), portals);
  if (senderPortal) return { portal: senderPortal, listingUrl: null, reason: "mittente_portale" };
  return null;
}

/** Le email promosse manualmente dal titolare non vengono mai lasciate in agenzia. */
export function promotedSellerClassification<T extends { classification: string; confidence: number; evidence: string }>(
  seller: T
): T {
  if (seller.classification !== "Agenzia") return seller;
  return {
    ...seller,
    classification: "Da verificare",
    confidence: 0,
    evidence: ("Avviso promosso manualmente; segnali di agenzia da verificare (" + seller.evidence + ")").slice(0, 500)
  };
}

export function captureDubiousAlertsEnabled(envValue: string | undefined): boolean {
  return String(envValue ?? "").trim().toLowerCase() === "true";
}
