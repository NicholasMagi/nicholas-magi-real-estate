import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseNameFallback,
  extractPhoneNumbers,
  hasNameIdentityConflict,
  normalizePhoneNumber,
  uniqueContactMatch
} from "../src/features/crm/phoneContactMatching.ts";

test("Italian international and national phone formats normalize equally", () => {
  assert.equal(normalizePhoneNumber("+39 333 123 4567"), "3331234567");
  assert.equal(normalizePhoneNumber("0039 333-123-4567"), "3331234567");
  assert.equal(normalizePhoneNumber("3331234567"), "3331234567");
});

test("phone normalization rejects short and overlong values", () => {
  assert.equal(normalizePhoneNumber("12345"), null);
  assert.equal(normalizePhoneNumber("1234567890123456"), null);
});

test("listing phone extraction handles text and structured seller identity", () => {
  assert.deepEqual(
    extractPhoneNumbers({
      contatto: "Mario Rossi - +39 333 123 4567",
      seller: { telephone: "333-765-4321" }
    }).sort(),
    ["3331234567", "3337654321"]
  );
});

test("a contact match is returned only when exactly one unique id exists", () => {
  assert.equal(uniqueContactMatch([{ id: "a" }, { id: "a" }])?.id, "a");
  assert.equal(uniqueContactMatch([{ id: "a" }, { id: "b" }]), null);
  assert.equal(uniqueContactMatch([]), null);
});

test("name-only fallback never overrides a different phone or email identity", () => {
  assert.equal(canUseNameFallback({ phoneNumbers: [], email: null, deviceNameCount: 1 }), true);
  assert.equal(canUseNameFallback({ phoneNumbers: ["3331234567"], email: null, deviceNameCount: 1 }), false);
  assert.equal(canUseNameFallback({ phoneNumbers: [], email: "mario@example.it", deviceNameCount: 1 }), false);
  assert.equal(canUseNameFallback({ phoneNumbers: [], email: null, deviceNameCount: 2 }), false);
});

test("same CRM name with a different phone or email is treated as an identity conflict", () => {
  assert.equal(hasNameIdentityConflict({
    nameMatchCount: 1,
    hasStrongIdentifier: true,
    strongMatchCount: 0
  }), true);
  assert.equal(hasNameIdentityConflict({
    nameMatchCount: 1,
    hasStrongIdentifier: true,
    strongMatchCount: 1
  }), false);
  assert.equal(hasNameIdentityConflict({
    nameMatchCount: 0,
    hasStrongIdentifier: true,
    strongMatchCount: 0
  }), false);
  assert.equal(hasNameIdentityConflict({
    nameMatchCount: 1,
    hasStrongIdentifier: false,
    strongMatchCount: 0
  }), false);
});
