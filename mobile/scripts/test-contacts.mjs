import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPhoneNumbers,
  normalizePhoneNumber,
  uniqueContactMatch
} from "../src/features/crm/phoneContactsSync.ts";

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
