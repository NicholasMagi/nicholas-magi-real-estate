// Verifica che il service worker registrato dall'app e il file pubblicato abbiano la stessa build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync("index.html", "utf8");
const worker = readFileSync("sw.js", "utf8");

const buildMatch = worker.match(/^\\/\\/ NMRE service worker build ([A-Za-z0-9._-]+)$/m);
assert.ok(buildMatch, "sw.js deve dichiarare un identificativo di build");

const references = [...index.matchAll(/(?:\\.\\/)?sw\\.js\\?v=([A-Za-z0-9._-]+)/g)]
  .map(match => match[1]);

assert.ok(references.length >= 1, "index.html deve registrare una versione esplicita di sw.js");
assert.ok(
  references.every(version => version === buildMatch[1]),
  "tutte le registrazioni devono usare la build dichiarata in sw.js: "
    + JSON.stringify({ worker: buildMatch[1], references })
);
assert.equal(new Set(references).size, 1, "l'app deve usare una sola versione del service worker");

console.log("Service worker: versione coerente tra index.html e sw.js.");
