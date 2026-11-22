import {
  ALLOWED_MUNICIPALITIES,
  buildInsightsSearchPayload,
  formatInsightsDate,
  toCandidate
} from "./provider.ts";

Deno.test("Insight search is restricted to private sale offers with phone available", () => {
  const payload = buildInsightsSearchPayload(new Date("2026-11-23T12:00:00Z"), 30, 2);
  if (payload.Filters.clientTypeID !== 1) throw new Error("Client type must be private");
  if (payload.Filters.comparableTypeID !== 1 || payload.Filters.contractTypeID !== 1) throw new Error("Search must target sale offers");
  if (payload.Filters.phoneNumberProvided !== true) throw new Error("Phone availability filter missing");
  if (payload.Pagination.page !== 2 || payload.Pagination.limit !== 10) throw new Error("Pagination mismatch");
  if (payload.Filters.pubblicationStatusID.join(",") !== "1,2") throw new Error("Only new/published listings should be returned");
});

Deno.test("Italian API date is formatted as DD/MM/YYYY", () => {
  const value = formatInsightsDate(new Date(2026, 10, 23));
  if (value !== "23/11/2026") throw new Error("Unexpected date: " + value);
});

Deno.test("Only allowed Marche municipalities and official listing URLs are imported", () => {
  const candidate = toCandidate({
    uuid: "abc-123",
    listingUrl: "https://www.immobiliare.it/annunci/123456789/",
    location: { municipality: "Castelfidardo" },
    extra: { title: "Casa indipendente" },
    propertyType: "Casa indipendente",
    value: { askingPrice: 185000 },
    grossSquareFootage: 120,
    rooms: 5,
    features: { numberOfBathrooms: 2 },
    clientType: "Privato",
    collectionDate: "23/11/2026"
  }, "user-id");
  if (!candidate) throw new Error("Expected candidate");
  if (candidate.tipo_venditore !== "Privato") throw new Error("Private seller classification mismatch");
  if (candidate.dedup_key !== "insights:immobiliare:abc-123") throw new Error("Deduplication key mismatch");
  if (candidate.prezzo !== 185000 || candidate.superficie_mq !== 120 || candidate.locali !== 5 || candidate.bagni !== 2) {
    throw new Error("Structured property fields mismatch");
  }
  if (toCandidate({
    uuid: "x",
    listingUrl: "https://www.immobiliare.it/annunci/123/",
    location: { municipality: "Milano" }
  }, "user-id") !== null) throw new Error("Outside-area listing must be skipped");
  if (toCandidate({
    uuid: "y",
    listingUrl: "https://example.com/annunci/123/",
    location: { municipality: "Ancona" }
  }, "user-id") !== null) throw new Error("Untrusted listing URL must be skipped");
});

Deno.test("Missing client classification never gets promoted to private", () => {
  const candidate = toCandidate({
    uuid: "abc-124",
    listingUrl: "https://immobiliare.it/annunci/123456780/",
    location: { municipality: "Osimo" },
    propertyType: "Appartamento"
  }, "user-id");
  if (!candidate || candidate.tipo_venditore !== "Da verificare") {
    throw new Error("Unknown seller must remain for manual review");
  }
});

Deno.test("The target municipality allowlist contains the core service area", () => {
  for (const town of ["castelfidardo", "ancona", "osimo", "recanati", "jesi", "macerata", "fermo"]) {
    if (!ALLOWED_MUNICIPALITIES.has(town)) throw new Error("Missing municipality: " + town);
  }
});
