// Test delle funzioni pure del pannello di recupero in index.html.
// Le funzioni vengono estratte dal file ed eseguite su dati sintetici.
// Uso: node tests/frontend/recovery_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");
function grab(name) {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  let depth = 0;
  for (let index = html.indexOf("{", start); index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}
const names = ["validUrl", "isSpecificCandidateUrl", "canonicalCandidateUrl", "nmreAppendStatusHistory",
  "nmreLastStatusEntry", "nmreDiscardEntry", "nmreAgencyDecisionOrigin", "candidateRecoveryGroup",
  "nmreNotificationsAfterDiscard"];
const api = new Function(
  'const NMRE_STATUS_HISTORY_LIMIT=50;const NMRE_DISCARD_ACTIONS=["scartato","classificato_agenzia_e_scartato"];' +
  names.map(grab).join("\n") + ";return {" + names.join(",") + "};"
)();

let failures = 0;
function eq(actual, expected, message) {
  if (actual !== expected) { failures++; console.error("FAIL " + message + " — ottenuto " + actual + ", atteso " + expected); }
  else console.log("ok   " + message);
}
const URL_A = "https://www.immobiliare.it/annunci/123456/";
const none = new Map();

// Storico delle decisioni
let history = api.nmreAppendStatusHistory({ piano: "2" }, { data: "t1", origine: "utente", azione: "scartato", motivo: "x".repeat(400) });
eq(history.piano, "2", "lo storico conserva gli altri dati estratti");
eq(history.storico_stato[0].motivo.length, 300, "motivo limitato a 300 caratteri");
for (let index = 0; index < 60; index++) history = api.nmreAppendStatusHistory(history, { data: String(index), origine: "utente", azione: "p" });
eq(history.storico_stato.length, 50, "storico limitato a 50 voci");

// Provenienza delle agenzie
eq(api.candidateRecoveryGroup({ id: "a1", tipo_venditore: "Agenzia", seller_manual_override: false }, none, "agency"),
  "agency_auto", "agenzia in attesa classificata dalla sincronizzazione: automatica");
eq(api.candidateRecoveryGroup({ id: "a2", tipo_venditore: "Agenzia", seller_manual_override: true, seller_evidence: "Verificato manualmente: agente o agenzia" }, none, "dismissed"),
  "agency_manual", "agenzia scartata dal titolare: manuale");
eq(api.candidateRecoveryGroup({ id: "a3", tipo_venditore: "Agenzia", seller_manual_override: false, seller_evidence: "Venditore indicato come agenzia o professionista" }, none, "dismissed"),
  "agency_auto_legacy", "agenzia scartata da una versione precedente: automatica storica");
eq(api.candidateRecoveryGroup({ id: "a4", tipo_venditore: "Agenzia", seller_manual_override: false,
  dati_estratti: { storico_stato: [{ origine: "utente", azione: "classificato_agenzia_e_scartato", a: "Agenzia" }] } }, none, "dismissed"),
  "agency_manual", "lo storico utente prevale come prova della decisione manuale");
eq(api.nmreAgencyDecisionOrigin({ seller_evidence: "Verificato manualmente: agente o agenzia" }), "manuale", "evidenza manuale riconosciuta");

// Altri scarti (inferenza AQ2)
const earliest = new Map([[api.canonicalCandidateUrl(URL_A), { id: "d0", updated_at: "2026-11-01" }]]);
eq(api.candidateRecoveryGroup({ id: "d1", tipo_venditore: "Da verificare", seller_manual_override: false, notification_sender: null, email_subject: null }, earliest),
  "sync", "scarto della sincronizzazione (mittente e oggetto azzerati)");
eq(api.candidateRecoveryGroup({ id: "d2", tipo_venditore: "Da verificare", notification_sender: "s", email_subject: "o", url: URL_A, updated_at: "2026-11-10" }, earliest),
  "same_url", "stesso link di uno scarto precedente");
eq(api.candidateRecoveryGroup({ id: "d3", tipo_venditore: "Da verificare", notification_sender: null, email_subject: null,
  dati_estratti: { storico_stato: [{ origine: "utente", azione: "scartato" }] } }, earliest), "manual", "lo storico utente prevale");

// Notifiche dopo lo scarto
const discardedAt = "2026-11-20T10:00:00Z";
const item = (extra) => ({ dati_estratti: { storico_stato: [{ azione: "scartato", data: discardedAt, origine: "utente" }] }, notification_history: [], ...extra });
eq(api.nmreNotificationsAfterDiscard(item({})).count, 0, "nessuna notifica: nessun contrassegno");
eq(api.nmreNotificationsAfterDiscard(item({ notification_history: [{ created_at: "2026-11-19T00:00:00Z" }] })).count, 0, "notifica precedente allo scarto: nessun contrassegno");
const after = api.nmreNotificationsAfterDiscard(item({ notification_history: [{ created_at: "2026-11-22T08:00:00Z", listing_price: 150000, price_drop_percent: null }] }));
eq(after.count, 1, "notifica senza ribasso dopo lo scarto: contrassegnata");
eq(after.latest.listing_price, 150000, "informazioni essenziali disponibili");
const seen = api.nmreNotificationsAfterDiscard(item({
  dati_estratti: { storico_stato: [{ azione: "scartato", data: discardedAt }], notifiche_dopo_scarto: { da_rivedere: false, visto_il: "2026-11-23T00:00:00Z" } },
  notification_history: [{ created_at: "2026-11-22T08:00:00Z" }] }));
eq(seen.count, 0, "dopo la presa visione la notifica già vista non è più evidenziata");
const legacy = api.nmreNotificationsAfterDiscard({ dati_estratti: { notifiche_dopo_scarto: { da_rivedere: true, conteggio: 2,
  elenco: [{ source_email_id: "m1", data: "2026-11-24T00:00:00Z", prezzo: 1 }, { source_email_id: "m2", data: "2026-11-25T00:00:00Z", prezzo: 2 }] } },
  notification_history: [] });
eq(legacy.count, 2, "scarto storico senza data: contrassegno dalla sincronizzazione");
eq(legacy.latest.listing_price, 2, "ultima notifica dal contrassegno");
const legacyNoMarker = api.nmreNotificationsAfterDiscard({ dati_estratti: {}, notification_history: [{ created_at: "2026-11-24T00:00:00Z" }] });
eq(legacyNoMarker.count, 0, "scarto storico senza data né contrassegno: nessuna supposizione");
eq(legacyNoMarker.discardKnown, false, "segnalato come data di scarto non registrata");

if (failures) { console.error(failures + " test non superati"); process.exit(1); }
console.log("Tutti i test del pannello di recupero superati.");
