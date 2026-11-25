import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateSellerPresentation,
  candidateStatusLabel,
  formatCandidatePrice,
  safeHttpsUrl
} from "../src/features/candidates/candidatePresentation.ts";

const seller = (overrides = {}) => ({
  sellerType: "Privato",
  status: "da_verificare",
  manualOverride: false,
  confidence: 0,
  evidence: null,
  ...overrides
});

test("a private seller remains unverified when the candidate workflow status is confirmed", () => {
  const result = candidateSellerPresentation(seller({ status: "confermato" }));
  assert.equal(result.label, "Privato da verificare");
  assert.equal(result.tone, "warning");
});

test("explicit manual private verification is the only path to confirmed private", () => {
  const result = candidateSellerPresentation(seller({
    manualOverride: true,
    confidence: 100,
    evidence: "Verificato manualmente: venditore privato · 2 identificativi memorizzati"
  }));
  assert.equal(result.label, "Privato confermato");
  assert.equal(result.tone, "success");
});

test("confidence and evidence without the manual override do not confirm a private seller", () => {
  const result = candidateSellerPresentation(seller({
    manualOverride: false,
    confidence: 100,
    evidence: "Verificato manualmente: venditore privato"
  }));
  assert.equal(result.label, "Privato da verificare");
});

test("manual override with another or missing evidence does not confirm a private seller", () => {
  const wrongEvidence = candidateSellerPresentation(seller({
    manualOverride: true,
    confidence: 100,
    evidence: "Verificato manualmente: identità del venditore non determinata"
  }));
  const missingEvidence = candidateSellerPresentation(seller({
    manualOverride: true,
    confidence: 100,
    evidence: null
  }));
  assert.equal(wrongEvidence.label, "Privato da verificare");
  assert.equal(missingEvidence.label, "Privato da verificare");
});

test("agency classification is never presented as a private seller", () => {
  const result = candidateSellerPresentation(seller({
    sellerType: "Agenzia",
    manualOverride: true,
    confidence: 100,
    evidence: "Verificato manualmente: agente o agenzia"
  }));
  assert.equal(result.label, "Agenzia");
  assert.equal(result.tone, "neutral");
});

test("empty or unknown seller classification remains unverified", () => {
  assert.equal(candidateSellerPresentation(seller({ sellerType: "Da verificare" })).label, "Venditore da verificare");
  assert.equal(candidateSellerPresentation(seller({ sellerType: null })).tone, "warning");
});

test("candidate workflow states are displayed independently from seller identity", () => {
  assert.equal(candidateStatusLabel("da_verificare"), "Da verificare");
  assert.equal(candidateStatusLabel("confermato"), "Confermato");
  assert.equal(candidateStatusLabel("scartato"), "Scartato");
});

test("external listing links must use HTTPS and cannot contain credentials", () => {
  assert.equal(safeHttpsUrl("https://www.idealista.it/immobile/123/"), "https://www.idealista.it/immobile/123/");
  assert.equal(safeHttpsUrl("http://example.com"), null);
  assert.equal(safeHttpsUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpsUrl("https://user:pass@example.com"), null);
});

test("candidate price is formatted in euros", () => {
  assert.match(formatCandidatePrice(125000), /125\.000/);
  assert.match(formatCandidatePrice(null), /non indicato/);
});
