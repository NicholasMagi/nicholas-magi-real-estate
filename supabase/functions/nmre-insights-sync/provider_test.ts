import {
  ALLOWED_MUNICIPALITIES,
  buildInsightsSearchPayload,
  formatInsightsDate,
  toCandidate
} from "./provider.ts";

Deno.test("Insight search is restricted to private sale offers with a phone number available", () => {
  const payload = buildInsightsSearchPayload(new Date("2026-11-23T12:00:00Z"), 30, 2);
  if (payload.Filters.clientTypeID !== 1) throw new Error("Client type must be private");
  if (payload.Filters.comparableTypeID !== 1 || payload.Filters.contractTypeID !== 1) throw new Error("Search must target asking offers for sale");
  if (payload.Filters.categoryTypeID !== 1) throw new Error("Search must target residential property");
  if (payload.Filters.phoneNumberProvided !== true) throw new Error("Phone availability filter missing");
  if (payload.Pagination.page !== 2 || payload.Pagination.limit !== 5) throw new Error("Pagination mismatch");
  if (payload.Filters.pubblicationStatusID.join(",") !== "1,2") throw new Error("Publication filters mismatch");
  if (payload.Filters.minDate !== "24/10/2026T00:00:00Z") throw new Error("Date format or lookback mismatch");
});

Deno.test("Italian date is formatted in the documented ISO suffix format", () => {
  const value = formatInsightsDate(new Date("2026-11-23T12:00:00Z"));
  if (value !== "23/11/2026T00:00:00Z") throw new Error("Unexpected date: " + value);
});

Deno.test("Documented Italian date format is parsed correctly", () => {
  const candidate = toCandidate({
    uuid: "date-1",
    listingUrl: "https://www.immobiliare.it/annunci/111111111/",
    location: { municipality: "Castelfidardo" },
    collectionDate: "23/11/2026T00:00:00Z"
  }, "user-id");
  if (!candidate) throw new Error("Expected candidate");
  if (candidate.data_pubblicazione !== "2026-11-23T00:00:00.000Z") {
    throw new Error("Unexpected parsed date: " + candidate.data_pubblicazione);
  }
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
    collectionDate: "2026-11-23T00:00:00Z"
  }, "user-id");
  if (!candidate) throw new Error("Expected candidate");
  if (candidate.tipo_venditore !== "Privato") throw new Error("Search-filtered private seller classification mismatch");
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

Deno.test("Explicit professional metadata is excluded", () => {
  const candidate = toCandidate({
    uuid: "abc-999",
    listingUrl: "https://immobiliare.it/annunci/123456780/",
    location: { municipality: "Osimo" },
    clientType: "Professionista"
  }, "user-id");
  if (candidate !== null) throw new Error("Agency listing must be excluded");
});

Deno.test("The target municipality allowlist contains the core service area", () => {
  for (const town of ["castelfidardo", "ancona", "osimo", "recanati", "jesi", "macerata", "fermo"]) {
    if (!ALLOWED_MUNICIPALITIES.has(town)) throw new Error("Missing municipality: " + town);
  }
});
