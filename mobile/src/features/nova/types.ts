export type NovaSellerClass = "Privato" | "Agenzia" | "Da verificare" | null;

export type NovaListingStatus =
  | "da_contattare"
  | "primo_contatto"
  | "interessato"
  | "appuntamento"
  | "incarico_acquisito"
  | "non_interessato"
  | string;

export type NovaAgencyStatus =
  | "nessuna"
  | "non_esclusiva"
  | "in_trattativa"
  | "esclusiva"
  | "da_verificare"
  | string;

export interface NovaPriceObservation {
  observedAt: string;
  listingPrice: number;
  previousPrice: number | null;
  priceDropPercent: number | null;
}

export interface NovaCandidate {
  id: string;
  title: string | null;
  municipality: string | null;
  askingPrice: number | null;
  sellerClass: NovaSellerClass;
  notificationAt: string | null;
  createdAt: string | null;
  hasDirectContact: boolean;
  listingUrl: string | null;
  propertyType: string | null;
  surfaceSqm: number | null;
  rooms: number | null;
  sellerConfidence: number | null;
  priceDropPercent: number | null;
  priceObservations: readonly NovaPriceObservation[];
}

export interface NovaListing {
  id: string;
  title: string | null;
  municipality: string | null;
  askingPrice: number | null;
  sellerClass: NovaSellerClass;
  status: NovaListingStatus;
  nextContactDate: string | null;
  lastContactAt: string | null;
  hasDirectContact: boolean;
  saleMotivation: string | null;
  saleTimeline: string | null;
  otherAgencies: NovaAgencyStatus | null;
  priceNegotiable: "si" | "parzialmente" | "no" | "da_verificare" | null;
  priceObservations: readonly NovaPriceObservation[];
}

export interface NovaInteraction {
  listingId: string;
  kind: string;
  outcomeCode: string | null;
  createdAt: string;
}

export interface NovaReadyContext {
  status: "ready";
  candidates: readonly NovaCandidate[];
  listings: readonly NovaListing[];
  interactions: readonly NovaInteraction[];
}

export type NovaContext =
  | { status: "not_connected" }
  | { status: "loading" }
  | { status: "error"; message?: string }
  | NovaReadyContext;

export type NovaActionKind = "candidate" | "listing";

export interface NovaSuggestedAction {
  kind: NovaActionKind;
  id: string;
  label: string;
}

export interface NovaReply {
  text: string;
  actions: readonly NovaSuggestedAction[];
}
