import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateSellerPresentation,
  candidateStatusLabel,
  formatCandidatePrice,
  safeHttpsUrl
} from "../src/features/candidates/candidatePresentation.ts";

test("a private seller is confirmed only when the candidate is confirmed", () => {
  assert.equal(candidateSellerPresentation("Privato", "confermato").label, "Privato confermato");
  assert.equal(candidateSellerPresentation("Privato", "da_verificare").label, "Privato da verificare");
});

test("agency classification is not presented as a private seller", () => {
  assert.equal(candidateSellerPresentation("Agenzia", "da_verificare").label, "Agenzia");
  assert.notEqual(candidateSellerPresentation("Agenzia", "confermato").label, "Privato confermato");
});

test("empty or unknown seller classification remains unverified", () => {
  assert.equal(candidateSellerPresentation("Da verificare", "da_verificare").label, "Venditore da verificare");
  assert.equal(candidateSellerPresentation(null, "da_verificare").tone, "warning");
});

test("candidate states are mapped explicitly", () => {
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
