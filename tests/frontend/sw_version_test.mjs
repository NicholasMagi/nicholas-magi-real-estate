// Una sola versione canonica del service worker: tutte le registrazioni in index.html usano
// NMRE_SW_URL, costruito da NMRE_SW_VERSION, che coincide con il commento in testa a sw.js.
// Uso: node tests/frontend/sw_version_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const sw = readFileSync(join(root, "sw.js"), "utf8");
let failures = 0;
function check(ok, message, detail) {
  if (ok) console.log("ok   " + message);
  else { failures++; console.error("FAIL " + message + (detail === undefined ? "" : " — " + JSON.stringify(detail))); }
}
const versions = [...html.matchAll(/const NMRE_SW_VERSION="([^"]+)";/g)].map(m => m[1]);
check(versions.length === 1, "NMRE_SW_VERSION è definita una sola volta", versions);
check(/^\d{8}-[a-z0-9-]+-\d+$/.test(versions[0] || ""), "formato della versione", versions[0]);
check(/const NMRE_SW_URL="\.\/sw\.js\?v="\+NMRE_SW_VERSION;/.test(html), "NMRE_SW_URL deriva dalla versione");
const registrations = [...html.matchAll(/navigator\.serviceWorker\.register\(([^)]*)\)/g)].map(m => m[1]);
check(registrations.length >= 3, "le registrazioni del service worker sono presenti", registrations.length);
check(registrations.every(arg => arg === "NMRE_SW_URL"), "ogni registrazione usa NMRE_SW_URL", registrations);
check(!/sw\.js\?v=\d/.test(html), "nessuna versione scritta a mano nell'app");
const build = (sw.match(/^\/\/ NMRE service worker build (\S+)/) || [])[1];
check(build === versions[0], "sw.js dichiara la stessa versione dell'app", { sw: build, app: versions[0] });
if (failures) { console.error(failures + " controlli non superati"); process.exit(1); }
console.log("Versione del service worker coerente: " + versions[0]);
