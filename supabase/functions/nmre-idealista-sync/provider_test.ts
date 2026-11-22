import {
  idealistaSearchForm,
  resolveMunicipality,
  toIdealistaCandidate
} from "./provider.ts";

Deno.test("Idealista search is Italian residential sale and has pagination", () => {
  const form = idealistaSearchForm(2, "43.465,13.547", 50000);
  if (form.get("center") !== "43.465,13.547") throw new Error("Unexpected search center");
  if (form.get("distance") !== "50000") throw new Error("Unexpected radius");
  if (form.get("country") !== null) throw new Error("Country is encoded in endpoint path, not form");
  if (form.get("propertyType") !== "homes" || form.get("operation") !== "sale") throw new Error("Search scope mismatch");
  if (form.get("numPage") !== "2" || form.get("maxItems") !== "50") throw new Error("Pagination mismatch");
});

Deno.test("Idealista result mapping restricts imports to the NMRE territory", () => {
  const candidate = toIdealistaCandidate({
    propertyCode: "12345678",
    url: "https://www.idealista.it/immobile/12345678/",
    municipality: "Castelfidardo (Ancona)",
    propertyType: "Appartamento",
    price: 185000,
    size: 120,
    rooms: 5,
    bathrooms: 2
  }, "user-id");
  if (!candidate) throw new Error("Expected a candidate");
  if (candidate.tipo_venditore !== "Da verificare") throw new Error("Unknown sellers must be reviewed");
  if (candidate.prezzo !== 185000 || candidate.superficie_mq !== 120 || candidate.locali !== 5 || candidate.bagni !== 2) {
    throw new Error("Property fields not mapped");
  }
  if (toIdealistaCandidate({
    propertyCode: "another",
    url: "https://www.idealista.it/immobile/another/",
    municipality: "Milano"
  }, "user-id") !== null) throw new Error("Outside-area candidate should be skipped");
});

Deno.test("Only explicit seller metadata can qualify as private", () => {
  const base = {
    propertyCode: "123",
    url: "https://www.idealista.it/immobile/123/",
    municipality: "Osimo"
  };
  const privateListing = toIdealistaCandidate({ ...base, contactType: "Privato" }, "user-id");
  const agencyListing = toIdealistaCandidate({ ...base, propertyCode: "456", url: "https://www.idealista.it/immobile/456/", contactType: "Agenzia" }, "user-id");
  if (privateListing?.tipo_venditore !== "Privato") throw new Error("Explicit private must be recognized");
  if (agencyListing !== null) throw new Error("Explicit agency must be filtered");
});

Deno.test("Rejects untrusted links and malformed listing identifiers", () => {
  if (toIdealistaCandidate({
    propertyCode: "x", url: "https://example.com/immobile/x/", municipality: "Ancona"
  }, "user-id") !== null) throw new Error("Untrusted URL accepted");
  if (toIdealistaCandidate({
    url: "https://www.idealista.it/immobile/x/", municipality: "Ancona"
  }, "user-id") !== null) throw new Error("Missing ID accepted");
  if (resolveMunicipality("Pescara") !== null) throw new Error("Outside area recognized");
});
