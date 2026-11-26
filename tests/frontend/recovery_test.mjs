// Test delle funzioni pure del pannello di recupero in index.html.
// Le funzioni vengono estratte dal file ed eseguite su dati sintetici.
// Uso: node tests/frontend/recovery_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");
function grab(name) {
  let start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  if (html.slice(start - 6, start) === "async ") start -= 6;
  let depth = 0;
  for (let index = html.indexOf("{", start); index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}
const names = ["nmreTime", "nmreNormalizeRecoveryRow", "nmreFetchAllById", "nmreFetchAllPages", "validUrl", "isSpecificCandidateUrl", "canonicalCandidateUrl", "nmreAppendStatusHistory",
  "nmreLastStatusEntry", "nmreDiscardEntry", "nmreAgencyDecisionOrigin", "candidateRecoveryGroup",
  "nmreNotificationsAfterDiscard", "nmreAgencyReopenUpdates"];
const api = new Function(
  'const NMRE_PAGE_SIZE=1000;const NMRE_STATUS_HISTORY_LIMIT=50;const NMRE_DISCARD_ACTIONS=["scartato","classificato_agenzia_e_scartato"];' +
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
const earliest = new Map([[api.canonicalCandidateUrl(URL_A), { id: "d0", time: api.nmreTime("2026-11-01") }]]);
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

// Agenzia riaperta per ribasso
const reopened = api.nmreAgencyReopenUpdates({ dati_estratti: { storico_stato: [
  { azione: "classificato_agenzia_e_scartato", origine: "utente", data: "2026-11-01T00:00:00Z" },
  { azione: "riaperto_per_ribasso", origine: "sincronizzazione", data: "2026-11-24T00:00:00Z", motivo: "Nuovo ribasso documentato (-5%)" }] } });
eq(reopened.count, 1, "agenzia riaperta per ribasso: evidenziata");
eq(reopened.reopenedForPriceDrop, true, "contrassegno 'Ribasso dopo lo scarto'");
eq(api.nmreAgencyReopenUpdates({ dati_estratti: { storico_stato: [
  { azione: "riaperto_per_ribasso" }, { azione: "riportato_in_revisione", origine: "utente" }] } }).count, 0,
  "una decisione successiva toglie il contrassegno");
eq(api.nmreAgencyReopenUpdates({}).count, 0, "agenzia senza storico: nessun contrassegno");

// Date confrontate come timestamp (B5)
eq(api.nmreTime("2026-11-25T21:00:00.123456+00:00"), Date.parse("2026-11-25T21:00:00.123Z"), "formato Postgres con microsecondi convertito");
eq(api.nmreTime("non una data"), null, "data non valida: null");
eq(api.nmreTime(null), null, "data assente: null");
const formats = api.nmreNotificationsAfterDiscard({ dati_estratti: { storico_stato: [{ azione: "scartato", data: "2026-11-20T10:00:00.500Z" }] },
  notification_history: [{ created_at: "2026-11-20T10:00:00+00:00" }, { created_at: "2026-11-20T11:00:00+01:00" }] });
eq(formats.count, 0, "notifiche precedenti allo scarto in formati diversi: nessun contrassegno (il confronto testuale sbagliava)");
eq(api.nmreNotificationsAfterDiscard({ dati_estratti: { storico_stato: [{ azione: "scartato", data: "2026-11-20T10:00:00Z" }] },
  notification_history: [{ notified_at: "2026-11-19T09:00:00Z", created_at: "2026-11-20T10:01:00Z" }] }).count, 0,
  "conta la data di arrivo dell'email (notified_at), non quella di registrazione");

// Secondo scarto (B2): il contrassegno di un ciclo precedente non torna "nuovo"
const cycle = { dati_estratti: {
  notifiche_dopo_scarto: { conteggio: 1, da_rivedere: true, elenco: [{ data: "2026-11-12T09:00:00Z", prezzo: 150000 }] },
  storico_stato: [
    { data: "2026-11-10T10:00:00Z", origine: "utente", azione: "scartato" },
    { data: "2026-11-12T09:00:01Z", origine: "sincronizzazione", azione: "nuova_notifica_dopo_scarto" },
    { data: "2026-11-13T10:00:00Z", origine: "utente", azione: "riportato_in_revisione" },
    { data: "2026-11-20T10:00:00Z", origine: "utente", azione: "scartato" }] },
  notification_history: [{ notified_at: "2026-11-12T09:00:00Z" }] };
eq(api.nmreNotificationsAfterDiscard(cycle).count, 0, "notifica precedente all'ultimo scarto: non mostrata come nuova");
cycle.dati_estratti.notifiche_dopo_scarto.elenco.push({ data: "2026-11-22T08:00:00Z", prezzo: 140000 });
cycle.notification_history.unshift({ notified_at: "2026-11-22T08:00:00Z", listing_price: 140000 });
const cycleNew = api.nmreNotificationsAfterDiscard(cycle);
eq(cycleNew.count, 1, "notifica successiva all'ultimo scarto: mostrata");
eq(cycleNew.latest.listing_price, 140000, "è quella successiva allo scarto");
const markerSeen = api.nmreNotificationsAfterDiscard({ dati_estratti: { notifiche_dopo_scarto: { da_rivedere: true, visto_il: "2026-11-23T00:00:00Z",
  elenco: [{ data: "2026-11-22T00:00:00Z" }, { data: "2026-11-24T00:00:00Z", prezzo: 9 }] } }, notification_history: [] });
eq(markerSeen.count, 1, "contrassegno: conta solo le notifiche dopo l'ultima presa visione");
eq(api.nmreNotificationsAfterDiscard({ dati_estratti: { notifiche_dopo_scarto: { da_rivedere: true } }, notification_history: [] }).count, 1,
  "contrassegno senza elenco: resta visibile (nel dubbio un annuncio in più)");

// Lettura parziale di dati_estratti (M4)
const normalized = api.nmreNormalizeRecoveryRow({ id: "x", storico: [{ azione: "scartato" }], notifiche: { da_rivedere: true } });
eq(JSON.stringify(Object.keys(normalized.dati_estratti).sort()), '["notifiche_dopo_scarto","storico_stato"]', "solo storico e contrassegno");
eq("storico" in normalized || "notifiche" in normalized, false, "alias rimossi dalla riga");
eq(api.nmreNormalizeRecoveryRow({ id: "y", storico: null, notifiche: null }).dati_estratti.storico_stato.length, 0, "valori assenti normalizzati");

// Paginazione (B5): più di 1000 righe con limite del server a 1000 e a 500
function fakeTable(total, cap) {
  const rows = Array.from({ length: total }, (_, index) => ({ id: String(index).padStart(6, "0") }));
  return () => {
    const state = { gt: null, limit: Infinity, from: 0, to: Infinity };
    const builder = {
      order() { return builder; },
      limit(value) { state.limit = value; return builder; },
      gt(_column, value) { state.gt = value; return builder; },
      range(from, to) { state.from = from; state.to = to; return builder; },
      then(resolve) {
        let list = rows.filter(row => state.gt === null || row.id > state.gt);
        list = list.slice(state.from, state.to + 1).slice(0, Math.min(state.limit, cap));
        resolve({ data: list, error: null });
      }
    };
    return builder;
  };
}
const paged = await api.nmreFetchAllById(fakeTable(2501, 1000));
eq(paged.data.length, 2501, "paginazione a chiave: 2501 righe lette con limite 1000");
eq(new Set(paged.data.map(row => row.id)).size, 2501, "nessuna riga duplicata");
eq((await api.nmreFetchAllById(fakeTable(1203, 500))).data.length, 1203, "paginazione a chiave con limite del server a 500");
eq((await api.nmreFetchAllPages(fakeTable(2501, 1000))).data.length, 2501, "paginazione a scostamento: 2501 righe");
eq((await api.nmreFetchAllPages(fakeTable(1203, 500))).data.length, 1203, "paginazione a scostamento con limite del server a 500");
eq((await api.nmreFetchAllPages(fakeTable(0, 1000))).data.length, 0, "tabella vuota");

if (failures) { console.error(failures + " test non superati"); process.exit(1); }
console.log("Tutti i test del pannello di recupero superati.");
