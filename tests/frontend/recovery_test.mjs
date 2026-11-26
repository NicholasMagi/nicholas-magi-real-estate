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
  // Il corpo inizia dopo la chiusura dei parametri ("){"): i valori predefiniti come guard={} non contano.
  for (let index = html.indexOf("){", start) + 1; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}
const names = ["nmreTime", "nmreNormalizeRecoveryRow", "nmreFetchAllById", "nmreFetchAllPages", "validUrl", "isSpecificCandidateUrl", "canonicalCandidateUrl", "nmreAppendStatusHistory",
  "nmreLastStatusEntry", "nmreDiscardEntry", "nmreAgencyDecisionOrigin", "candidateRecoveryGroup",
  "nmreLastSeenEntry", "nmreNotificationsAfterDiscard", "nmreAgencyReopenUpdates"];
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

// Verifica del venditore (saveCandidateSeller): il registro venditori si scrive solo
// dopo che il controllo ottimistico ha accettato la modifica del candidato.
function sellerHarness({ conflict = false, registryError = null } = {}) {
  const calls = [];
  const db = { annunci_candidati: [{ id: "c1", owner_id: "u1", stato: "da_verificare", tipo_venditore: "Da verificare",
    updated_at: "2026-11-26T08:00:00.123456+00:00", dati_estratti: { pagina_pubblica: { testo: "dati" } } }] };
  let afterRead = conflict ? row => { row.updated_at = "2026-11-26T08:00:05.000000+00:00"; row.dati_estratti.dato_sincronizzazione = "nuova email"; } : null;
  const supabase = {
    from(table) {
      const state = { table, filters: [], op: "select", payload: null, single: false, returning: false };
      const builder = {
        select() { if (state.op !== "select") state.returning = true; return builder; },
        eq(column, value) { state.filters.push(row => String(row[column]) === String(value)); return builder; },
        is(column, value) { state.filters.push(row => (row[column] ?? null) === value); return builder; },
        maybeSingle() { state.single = true; return builder; },
        update(payload) { state.op = "update"; state.payload = payload; return builder; },
        upsert(rows, options) { state.op = "upsert"; state.payload = rows; state.options = options; return builder; },
        then(resolve) {
          calls.push({ table, op: state.op });
          if (state.op === "upsert") { resolve({ data: null, error: registryError }); return; }
          const rows = (db[table] || []).filter(row => state.filters.every(filter => filter(row)));
          if (state.op === "update") { rows.forEach(row => Object.assign(row, JSON.parse(JSON.stringify(state.payload)))); resolve({ data: state.returning ? rows.map(row => ({ id: row.id })) : null, error: null }); return; }
          const data = state.single ? (rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null) : rows;
          if (state.single && afterRead && rows[0]) { const hook = afterRead; afterRead = null; hook(rows[0]); }
          resolve({ data, error: null });
        }
      };
      return builder;
    },
    rpc: async () => { calls.push({ table: "rpc", op: "rpc" }); return { data: { archived: false }, error: null }; }
  };
  const messages = [];
  const fields = { venditore: "Agenzia", seller_identity: "Immobiliare Rossi Srl", contatto: "info@rossi-immobili.it 333 1234567" };
  const card = { querySelector: selector => { const key = (selector.match(/data-field="([^"]+)"/) || [])[1]; return key in fields ? { value: fields[key] } : null; } };
  const button = { disabled: false, closest: () => card };
  const fn = new Function("supabase", "msg", "confirm", "currentUser", "candidateCache", "loadSellerRegistry", "loadCandidates", "loadListings", "prepareCandidateForArchive",
    'const NMRE_STATUS_HISTORY_LIMIT=50;const NMRE_CONFLICT_MESSAGE="L’annuncio è stato modificato nel frattempo";' +
    ["normalizeSellerIdentifier", "buildSellerRegistryRows", "nmreAppendStatusHistory", "nmreUpdateCandidateWithHistory", "saveCandidateSeller"].map(grab).join("\n") +
    ";return saveCandidateSeller;")(
    supabase, (_id, text, type) => messages.push({ text, type }), () => true, { id: "u1" }, [{ id: "c1", tipo_venditore: "Da verificare" }],
    async () => calls.push({ table: "reload", op: "seller_registry" }), async () => calls.push({ table: "reload", op: "candidates" }), async () => {},
    async () => ({ persisted: true }));
  return { run: () => fn("c1", button), calls, db, messages, button };
}
{
  const h = sellerHarness({ conflict: true });
  await h.run();
  const row = h.db.annunci_candidati[0];
  eq(h.calls.filter(call => call.table === "seller_identity_registry").length, 0, "verifica venditore in conflitto: nessuna scrittura nel registro venditori");
  eq(row.tipo_venditore, "Da verificare", "verifica venditore in conflitto: classificazione del candidato invariata");
  eq(row.dati_estratti.dato_sincronizzazione, "nuova email", "verifica venditore in conflitto: dato della sincronizzazione conservato");
  eq(Array.isArray(row.dati_estratti.storico_stato), false, "verifica venditore in conflitto: nessuna voce di storico scritta");
  eq(/modificato nel frattempo/.test(h.messages.at(-1)?.text || ""), true, "verifica venditore in conflitto: messaggio di conflitto");
  eq(h.button.disabled, false, "verifica venditore in conflitto: pulsante riattivato per un nuovo tentativo");
}
{
  const h = sellerHarness();
  await h.run();
  const order = h.calls.filter(call => call.op === "update" || call.table === "seller_identity_registry").map(call => call.table + ":" + call.op);
  eq(order.join(","), "annunci_candidati:update,seller_identity_registry:upsert", "verifica venditore accettata: registro scritto dopo il candidato");
  eq(h.db.annunci_candidati[0].tipo_venditore, "Agenzia", "verifica venditore accettata: classificazione salvata");
  eq(h.db.annunci_candidati[0].dati_estratti.storico_stato.at(-1).azione, "classificato_agenzia_e_scartato", "verifica venditore accettata: storico registrato");
  eq(h.messages.at(-1).type, "success", "verifica venditore accettata: esito positivo");
}
{
  const h = sellerHarness({ registryError: { message: "errore di rete" } });
  await h.run();
  eq(h.db.annunci_candidati[0].tipo_venditore, "Agenzia", "registro non disponibile: classificazione del candidato comunque salvata");
  const last = h.messages.at(-1);
  eq(last.type === "error" && /NON sono stati memorizzati/.test(last.text) && !/identità è stata memorizzata/.test(last.text), true,
    "registro non disponibile: l'utente non riceve una falsa conferma di memorizzazione");
}

if (failures) { console.error(failures + " test non superati"); process.exit(1); }
console.log("Tutti i test del pannello di recupero superati.");
