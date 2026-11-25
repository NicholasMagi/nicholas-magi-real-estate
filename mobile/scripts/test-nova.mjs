import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNovaActionPlan,
  candidatePriority,
  candidateQuality,
  respondToNova
} from "../src/features/nova/engine.ts";

function dateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function makeCandidate(overrides = {}) {
  return {
    id: "candidate-1",
    title: "Appartamento luminoso",
    municipality: "Osimo",
    askingPrice: 145000,
    sellerClass: "Privato",
    notificationAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    hasDirectContact: true,
    listingUrl: "https://www.idealista.it/immobile/12345678/",
    propertyType: "Appartamento",
    surfaceSqm: 90,
    rooms: 4,
    sellerConfidence: 95,
    priceDropPercent: null,
    priceObservations: [],
    ...overrides
  };
}

function makeListing(overrides = {}) {
  return {
    id: "listing-1",
    title: "Casa da ricontattare",
    municipality: "Osimo",
    askingPrice: 130000,
    sellerClass: "Privato",
    listingUrl: null,
    propertyType: "Appartamento",
    surfaceSqm: 90,
    rooms: 4,
    status: "interessato",
    nextContactDate: null,
    lastContactAt: null,
    hasDirectContact: true,
    saleMotivation: "Trasferimento",
    saleTimeline: "entro_30_giorni",
    otherAgencies: "nessuna",
    priceNegotiable: "si",
    priceObservations: [],
    ...overrides
  };
}

function readyContext({ candidates = [], listings = [], interactions = [] } = {}) {
  return { status: "ready", candidates, listings, interactions };
}

test("does not invent live data before secure mobile connection", () => {
  const reply = respondToNova("Chi devo contattare per primo?", { status: "not_connected" });
  assert.match(reply.text, /archivio NMRE non è ancora collegato/i);
  assert.equal(reply.actions.length, 0);
});

test("can prepare a generic owner call without an AI API", () => {
  const reply = respondToNova("Preparami una telefonata per un proprietario", { status: "not_connected" });
  assert.match(reply.text, /Ghergo Immobiliare/);
  assert.match(reply.text, /motivo principale della vendita/);
});

test("matches the existing commercial priority score for a complete private candidate", () => {
  const now = new Date();
  const candidate = makeCandidate({ notificationAt: now.toISOString(), createdAt: now.toISOString() });
  const score = candidatePriority(candidate, now);
  assert.equal(score.score, 100);
  assert.equal(score.label, "Alta");
});

test("does not add the private-seller bonus to an unverified seller", () => {
  const candidate = makeCandidate({ sellerClass: "Da verificare" });
  const score = candidatePriority(candidate);
  assert.ok(score.score < 100);
  assert.ok(score.reasons.some(reason => reason.includes("Venditore da qualificare")));
});

test("quality check catches missing data and possible duplicates", () => {
  const candidate = makeCandidate({
    id: "incomplete",
    municipality: null,
    askingPrice: null,
    surfaceSqm: null,
    hasDirectContact: false,
    listingUrl: "https://www.idealista.it/immobile/87654321/"
  });
  const duplicate = makeCandidate({
    id: "duplicate",
    title: candidate.title,
    listingUrl: "https://www.idealista.it/immobile/87654321/"
  });
  const quality = candidateQuality(candidate, [candidate, duplicate], []);
  assert.ok(quality.missing.includes("comune"));
  assert.ok(quality.missing.includes("prezzo"));
  assert.ok(quality.recommendedMissing.includes("recapito diretto da verificare"));
  assert.equal(quality.possibleDuplicate, true);
});

test("action plan places overdue callbacks before candidate prospecting", () => {
  const now = new Date(2026, 10, 25, 12, 0, 0);
  const yesterday = dateOnly(new Date(2026, 10, 24));
  const context = readyContext({
    candidates: [makeCandidate()],
    listings: [makeListing({ nextContactDate: yesterday })]
  });
  const actions = buildNovaActionPlan(context, null, now);
  assert.equal(actions[0]?.tag, "RICHIAMO IN RITARDO");
  assert.ok(actions.some(action => action.kind === "candidate"));
});

test("action plan excludes owners with an active exclusive agreement", () => {
  const context = readyContext({
    listings: [
      makeListing({ id: "exclusive", otherAgencies: "esclusiva", nextContactDate: "2026-11-20" })
    ]
  });
  const actions = buildNovaActionPlan(context, null, new Date(2026, 10, 25, 12, 0, 0));
  assert.equal(actions.length, 0);
});

test("lists only confirmed private candidates and keeps unverified ones separate", () => {
  const context = readyContext({
    candidates: [
      makeCandidate({ id: "private-1", sellerClass: "Privato" }),
      makeCandidate({ id: "unknown-1", sellerClass: "Da verificare", title: "Casa da verificare" })
    ]
  });
  const reply = respondToNova("Mostrami i privati migliori a Osimo", context);
  assert.match(reply.text, /Appartamento luminoso/);
  assert.doesNotMatch(reply.text, /Casa da verificare/);
  assert.equal(reply.actions.length, 1);
});

test("summarizes overdue and upcoming callbacks", () => {
  const overdueDate = new Date();
  overdueDate.setDate(overdueDate.getDate() - 5);
  const context = readyContext({
    listings: [
      makeListing({ id: "old", nextContactDate: dateOnly(overdueDate) }),
      makeListing({ id: "today", status: "appuntamento", nextContactDate: dateOnly(new Date()) })
    ]
  });
  const reply = respondToNova("Quali richiami sto trascurando?", context);
  assert.match(reply.text, /in ritardo/);
  assert.match(reply.text, /da fare oggi/);
  assert.equal(reply.actions.length, 2);
});

test("reports documented price reductions only from actual observations", () => {
  const now = new Date().toISOString();
  const candidate = makeCandidate({
    title: "Villa ribassata",
    priceObservations: [{
      observedAt: now,
      listingPrice: 260000,
      previousPrice: 280000,
      priceDropPercent: 7.14
    }]
  });
  const reply = respondToNova("Quali immobili hanno avuto un ribasso?", readyContext({ candidates: [candidate] }));
  assert.match(reply.text, /280\.000/);
  assert.match(reply.text, /260\.000/);
  assert.match(reply.text, /7,14/);
  assert.equal(reply.actions.length, 1);
});

test("reports data gaps without attempting to fill them", () => {
  const candidate = makeCandidate({
    municipality: null,
    askingPrice: null,
    hasDirectContact: false,
    listingUrl: null,
    propertyType: null,
    surfaceSqm: null
  });
  const reply = respondToNova("Mostrami le schede incomplete", readyContext({ candidates: [candidate] }));
  assert.match(reply.text, /da completare/i);
  assert.match(reply.text, /recapito diretto/i);
  assert.equal(reply.actions[0]?.id, candidate.id);
});

test("explains that this native phase does not call OpenAI", () => {
  const reply = respondToNova("Quanto costa NOVA?", { status: "not_connected" });
  assert.match(reply.text, /non invia richieste a OpenAI/i);
});
