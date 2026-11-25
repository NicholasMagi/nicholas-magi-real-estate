import test from "node:test";
import assert from "node:assert/strict";
import { toFriendlyAuthError } from "../src/features/auth/authErrors.ts";

test("invalid credentials never expose provider internals", () => {
  assert.equal(toFriendlyAuthError(new Error("Invalid login credentials")), "Email o password non corrette.");
});
test("unconfirmed email gets a clear next step", () => {
  assert.match(toFriendlyAuthError(new Error("Email not confirmed")), /non risulta ancora confermato/);
});
test("rate limiting advises the user to wait", () => {
  assert.match(toFriendlyAuthError(new Error("Too many requests")), /troppi tentativi/);
});
test("network failure is distinguished from wrong credentials", () => {
  assert.match(toFriendlyAuthError(new Error("Network request failed")), /connessione/);
});
test("unknown auth errors remain generic and do not echo raw messages", () => {
  assert.equal(toFriendlyAuthError(new Error("secret token abc123")), "Accesso non riuscito. Verifichi i dati e riprovi.");
});
