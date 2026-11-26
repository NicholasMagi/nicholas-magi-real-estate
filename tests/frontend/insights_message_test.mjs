// Messaggi della sincronizzazione Immobiliare.it Insights (syncInsightsApi in index.html)
// su risposte simulate della Edge Function. Uso: node tests/frontend/insights_message_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.html"), "utf8");
function grab(name) {
  let start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  if (html.slice(start - 6, start) === "async ") start -= 6;
  let depth = 0;
  for (let index = html.indexOf("){", start) + 1; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}
let failures = 0;
const eq = (actual, expected, message) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) { failures++; console.error("FAIL " + message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected)); } else console.log("ok   " + message); };

async function run(response, canImport = true) {
  const elements = { syncInsightsApi: { disabled: false }, checkInsightsApi: { disabled: false }, insightsApiStatus: { textContent: "" } };
  const messages = [];
  let reloaded = 0;
  const fn = new Function("supabase", "currentUser", "$", "msg", "loadCandidates", "insightsCanImport",
    grab("syncInsightsApi") + ";return syncInsightsApi;")(
    { functions: { invoke: async () => ({ data: response, error: null }) } }, { id: "u1" },
    id => elements[id], (_target, text, kind) => messages.push({ text, kind }), async () => { reloaded++; }, canImport);
  await fn();
  return { elements, message: messages.at(-1), reloaded };
}

const complete = { success: true, completeness: "completo", privateListingsInArea: 42, inserted: 7, alreadyPresent: 30, alreadyInArchive: 5,
  matchedAsPrivate: 3, detailPrivate: 2, detailProfessional: 1, phoneFlagged: 11, insertFailures: 0, note: "Nota." };
{
  const { elements, message, reloaded } = await run(complete);
  eq(elements.insightsApiStatus.textContent, "Ultima ricerca completata · 42 annunci di privati in area", "stato: ricerca completa");
  eq(message.kind, "success", "esito positivo");
  eq(/7 nuovi annunci di privati importati come «Da verificare»/.test(message.text), true, "nuovi annunci");
  eq(/5 già nell’Archivio, non duplicati/.test(message.text), true, "annunci già nell'Archivio");
  eq(/numero non restituito dall’API/.test(message.text), true, "nessun numero di telefono dichiarato");
  eq(/undefined|NaN/.test(message.text), false, "nessun valore mancante nel messaggio");
  eq(reloaded, 1, "elenco delle opportunità aggiornato");
}
{
  const { elements, message } = await run({ ...complete, completeness: "parziale", insertFailures: 2 });
  eq(elements.insightsApiStatus.textContent.startsWith("Ultima ricerca parziale"), true, "stato: ricerca parziale");
  eq(/ricerca parziale: non tutte le pagine sono state lette/.test(message.text) && /2 annunci non salvati per errore/.test(message.text), true, "parziale ed errori di salvataggio segnalati");
}
{
  const { elements, message, reloaded } = await run({ success: false, code: "INSIGHTS_SEARCH_FAILED", error: "Ricerca Immobiliare.it Insights non riuscita: nessun annuncio importato e nessun dato modificato." });
  eq([elements.insightsApiStatus.textContent, message.kind, reloaded], ["Ultima ricerca non riuscita", "error", 0], "ricerca non riuscita: errore, nessun aggiornamento");
}
{
  // Con l'autorizzazione mancante la verifica dello stato restituisce canImport=false.
  const { elements, message } = await run({ success: false, code: "INSIGHTS_LEAD_USE_NOT_APPROVED", error: "Serve la conferma scritta." }, false);
  eq([elements.insightsApiStatus.textContent, elements.syncInsightsApi.disabled, message.kind], ["In attesa di autorizzazione scritta del fornitore", true, "error"], "autorizzazione mancante: importazione disattivata");
}
if (failures) { console.error(failures + " test non superati"); process.exit(1); }
console.log("Tutti i test dei messaggi Insights superati.");
