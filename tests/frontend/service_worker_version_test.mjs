// Verifica che il service worker registrato dall'app e il file pubblicato abbiano la stessa build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync("index.html", "utf8");
const worker = readFileSync("sw.js", "utf8");

const buildPrefix = "// NMRE service worker build ";
const buildLine = worker.split(/\r?\n/).find(line => line.startsWith(buildPrefix));
assert.ok(buildLine, "sw.js deve dichiarare un identificativo di build");
const workerBuild = buildLine.slice(buildPrefix.length).trim();

const references = index
  .split("sw.js?v=")
  .slice(1)
  .map(part => part.match(/^[A-Za-z0-9._-]+/)?.[0])
  .filter(Boolean);

assert.ok(references.length >= 1, "index.html deve registrare una versione esplicita di sw.js");
assert.ok(
  references.every(version => version === workerBuild),
  "tutte le registrazioni devono usare la build dichiarata in sw.js: "
    + JSON.stringify({ worker: workerBuild, references })
);
assert.equal(new Set(references).size, 1, "l'app deve usare una sola versione del service worker");

console.log("Service worker: versione coerente tra index.html e sw.js.");
