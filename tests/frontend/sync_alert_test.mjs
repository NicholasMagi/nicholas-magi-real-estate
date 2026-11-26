// Allarme sulla sincronizzazione Gmail: salute calcolata dallo storico nmre_gmail_sync_runs
// e avviso visibile in ogni schermata. Funzioni estratte da index.html.
// Uso: node tests/frontend/sync_alert_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");
function grab(name) {
  let start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  let depth = 0;
  for (let index = html.indexOf("){", start) + 1; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}

// DOM minimo per l'avviso.
const nodes = {};
function node(id) {
  return nodes[id] ??= { hidden: true, textContent: "", classes: new Set(), classList: { toggle(name, on) { on ? this._s.add(name) : this._s.delete(name); }, _s: null } };
}
for (const id of ["nmreSyncAlert", "nmreSyncAlertTitle", "nmreSyncAlertText"]) { const n = node(id); n.classList._s = n.classes; }
const api = new Function("$", ["nmreSyncHealth", "nmreRenderSyncAlert"].map(grab).join("\n") + ";return {nmreSyncHealth,nmreRenderSyncAlert};")(id => nodes[id] || null);

let failures = 0;
function eq(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error("FAIL " + message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected));
  } else console.log("ok   " + message);
}
const NOW = Date.parse("2026-11-26T12:00:00Z");
const at = minutesAgo => new Date(NOW - minutesAgo * 60000).toISOString();
const ok = minutesAgo => ({ status: "success", completed_at: at(minutesAgo) });
const ko = minutesAgo => ({ status: "error", completed_at: at(minutesAgo), error_message: "Errore" });

eq(api.nmreSyncHealth([], NOW).level, "unknown", "nessuno storico: nessun allarme inventato");
eq(api.nmreSyncHealth([ok(4), ok(14)], NOW).level, "ok", "esecuzioni regolari ogni 10 minuti");
eq(api.nmreSyncHealth([ko(3), ok(13)], NOW).level, "warning", "un errore isolato: avviso");
eq(api.nmreSyncHealth([ko(3), ko(13), ok(23)], NOW).level, "warning", "due errori consecutivi: avviso");
const three = api.nmreSyncHealth([ko(2), ko(12), ko(22), ok(28)], NOW);
eq([three.level, three.consecutiveFailures], ["error", 3], "tre errori consecutivi: acquisizione bloccata");
eq(/3 sincronizzazioni consecutive non riuscite/.test(three.text), true, "testo con il numero di errori");
const stale = api.nmreSyncHealth([ok(45)], NOW);
eq([stale.level, stale.minutesSinceSuccess], ["error", 45], "nessuna esecuzione riuscita da 45 minuti: bloccata");
eq(api.nmreSyncHealth([ok(25)], NOW).level, "warning", "ultimo controllo oltre 20 minuti fa: ritardo");
eq(api.nmreSyncHealth([ko(1), ko(11)], NOW).level, "error", "solo errori nello storico: bloccata");
eq(/ore/.test(api.nmreSyncHealth([ok(180)], NOW).text), true, "ritardi lunghi espressi in ore");

api.nmreRenderSyncAlert(three);
eq([nodes.nmreSyncAlert.hidden, nodes.nmreSyncAlertTitle.textContent], [false, "Acquisizione Gmail bloccata."], "avviso visibile in caso di blocco");
eq(nodes.nmreSyncAlert.classes.has("nmre-sync-alert-warning"), false, "stile di errore");
api.nmreRenderSyncAlert(api.nmreSyncHealth([ko(3), ok(13)], NOW));
eq(nodes.nmreSyncAlert.classes.has("nmre-sync-alert-warning"), true, "stile di avviso");
api.nmreRenderSyncAlert(api.nmreSyncHealth([ok(4)], NOW));
eq(nodes.nmreSyncAlert.hidden, true, "avviso nascosto quando la sincronizzazione è regolare");

eq(/<div id="nmreSyncAlert" class="nmre-sync-alert" role="alert" hidden>/.test(html), true, "avviso presente in cima all'app, accessibile");
eq(/<main class="wrap">\n<div id="nmreSyncAlert"/.test(html), true, "avviso posizionato prima di ogni sezione");
eq(/nmreRenderSyncAlert\(nmreSyncHealth\(runs,Date\.now\(\)\)\)/.test(html), true, "aggiornato a ogni lettura del monitor (ogni minuto)");
eq(/nmreSyncAlertOpen"\)\?\.addEventListener\("click",\(\)=>nmreNavigateToTarget\("gmailSyncTitle"\)\)/.test(html), true, "il pulsante apre il monitor della sincronizzazione");

if (failures) { console.error(failures + " test non superati"); process.exit(1); }
console.log("Tutti i test dell'allarme di sincronizzazione superati.");
