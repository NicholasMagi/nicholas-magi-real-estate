// Test di loadCandidateRecovery() e del suo stato nel pannello (renderCandidateRecovery()).
// Le funzioni e le costanti vengono estratte da index.html ed eseguite così come sono,
// con un Supabase simulato (limite di 1000 righe per richiesta, guasti programmabili)
// e un DOM minimo. Uso: node tests/frontend/recovery_load_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// Estrae una funzione (anche async) dal file: il corpo inizia dopo "){".
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
// Estrae una dichiarazione "const NOME=...;" fino al punto e virgola di livello zero.
function grabConst(name) {
  const start = html.indexOf("const " + name + "=");
  if (start < 0) throw new Error("Costante non trovata: " + name);
  let depth = 0, quote = null;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quote) { if (char === "\\") index++; else if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("{[(".includes(char)) depth++;
    else if ("}])".includes(char)) depth--;
    else if (char === ";" && depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Costante non chiusa: " + name);
}

const FUNCTIONS = ["safe", "euro", "validUrl", "isSpecificCandidateUrl", "canonicalCandidateUrl", "nmreTime",
  "nmreFetchAllById", "nmreFetchAllPages", "nmreNormalizeRecoveryRow", "nmreLastStatusEntry", "nmreDiscardEntry",
  "nmreAgencyDecisionOrigin", "candidateRecoveryGroup", "nmreLastSeenEntry", "nmreNotificationsAfterDiscard", "nmreAgencyReopenUpdates",
  "nmreRecoveryAlertIds", "loadCandidateRecovery", "renderCandidateRecovery"];
const CONSTANTS = ["NMRE_PAGE_SIZE", "NMRE_RECOVERY_FULL_TTL", "NMRE_RECOVERY_PAGE", "NMRE_RECOVERY_COLUMNS",
  "NMRE_RECOVERY_GROUP_LABELS", "NMRE_DISCARD_ACTIONS"];

// ---------- Supabase simulato ----------
function fakeSupabase(db) {
  // fail = { table, call }: la richiesta numero "call" verso "table" restituisce un errore.
  const control = { calls: [], fail: null, counts: {} };
  const getPath = (row, expr) => {
    const parts = expr.split(/->>?/); let value = row[parts[0]];
    for (const key of parts.slice(1)) value = value && typeof value === "object" ? value[key] : undefined;
    return value === undefined ? null : value;
  };
  const project = (row, select) => {
    const out = {};
    for (const raw of select.split(",")) {
      const item = raw.trim(); if (!item) continue;
      const [alias, expr] = item.includes(":") ? item.split(":") : [item, item];
      out[alias] = JSON.parse(JSON.stringify(getPath(row, expr)));
    }
    return out;
  };
  const client = {
    from(table) {
      const q = { filters: [], orders: [], limit: null, range: null, select: "*" };
      const builder = {
        select(value) { q.select = value; return builder; },
        eq(column, value) { q.filters.push(row => String(getPath(row, column)) === String(value)); return builder; },
        in(column, values) { q.filters.push(row => values.map(String).includes(String(getPath(row, column)))); return builder; },
        gt(column, value) { q.filters.push(row => String(getPath(row, column)) > String(value)); return builder; },
        order(column, options = {}) { q.orders.push([column, options.ascending !== false]); return builder; },
        limit(value) { q.limit = value; return builder; },
        range(from, to) { q.range = [from, to]; return builder; },
        then(resolve) {
          control.calls.push(table);
          control.counts[table] = (control.counts[table] || 0) + 1;
          if (control.fail && control.fail.table === table && control.fail.call === control.counts[table]) {
            control.fail = null;
            resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
            return;
          }
          let rows = (db[table] || []).filter(row => q.filters.every(filter => filter(row)));
          if (q.orders.length) rows = rows.slice().sort((a, b) => {
            for (const [column, asc] of q.orders) {
              const x = String(a[column] ?? ""), y = String(b[column] ?? "");
              if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
            }
            return 0;
          });
          if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
          if (q.limit !== null) rows = rows.slice(0, q.limit);
          rows = rows.slice(0, 1000); // max-rows di Supabase
          resolve({ data: rows.map(row => project(row, q.select)), error: null });
        }
      };
      return builder;
    }
  };
  return { client, control };
}

// ---------- DOM minimo ----------
function fakeDom() {
  const elements = {
    candidateRecoveryList: { innerHTML: "", querySelectorAll: () => [] },
    candidateRecoverySummary: { textContent: "" },
    candidateRecoveryPanel: { open: true, scrollIntoView() {} },
    candidateRecoveryAlert: { hidden: true, innerHTML: "" },
    candidateRecoveryFilter: { value: "all" },
    candidateMsg: { textContent: "", className: "" }
  };
  const listeners = {};
  // Gli elementi creati via innerHTML (per esempio il pulsante Riprova) esistono solo
  // se il loro id compare nel markup del pannello o dell'avviso.
  const $ = id => {
    if (elements[id]) return elements[id];
    const markup = elements.candidateRecoveryList.innerHTML + elements.candidateRecoveryAlert.innerHTML;
    if (!markup.includes('id="' + id + '"')) return null;
    return { addEventListener(type, handler) { listeners[id] = handler; } };
  };
  return { $, elements, listeners };
}

// ---------- Ambiente con lo stato del modulo ----------
function environment(db) {
  const { client, control } = fakeSupabase(db);
  const dom = fakeDom();
  const messages = [];
  let clock = Date.parse("2026-11-26T09:00:00Z");
  class FakeDate extends Date { static now() { return clock; } }
  const msg = (id, text, type = "") => { dom.elements[id].textContent = text; dom.elements[id].className = "status " + type; messages.push({ text, type }); };
  const api = new Function("supabase", "$", "msg", "Date",
    "let currentUser={id:'u1'};let candidateRecoveryLoading=null,candidateRecoveryError=null,candidateRecoveryInvalidated=false;" +
    "let candidateDismissedCache=[],candidateRecoveryLoadedAt=0,candidateDismissedIndex=[],candidateDismissedIndexAt=0;" +
    "let candidateAgencyCache=[],candidateRecoveryFlagged=[],candidateRecoveryLimit=300;" +
    CONSTANTS.map(grabConst).join("\n") + "\n" + FUNCTIONS.map(grab).join("\n") +
    ";return {loadCandidateRecovery,renderCandidateRecovery," +
    "state:()=>({cache:candidateDismissedCache,loadedAt:candidateRecoveryLoadedAt,error:candidateRecoveryError,index:candidateDismissedIndex})};"
  )(client, dom.$, msg, FakeDate);
  return { api, control, dom, messages, tick: ms => { clock += ms; } };
}

// ---------- Dati ----------
const iso = hour => new Date(Date.UTC(2026, 8, 1) + hour * 3600000).toISOString();
function dataset({ candidates = 3, historyFor = "d001", history = 1500 } = {}) {
  const annunci_candidati = Array.from({ length: candidates }, (_, i) => ({
    id: "d" + String(i + 1).padStart(3, "0"), owner_id: "u1", stato: "scartato", tipo_venditore: "Da verificare",
    seller_manual_override: false, titolo: "Scarto " + (i + 1), comune: "Ancona", url: "https://www.immobiliare.it/annunci/" + (100000 + i) + "/",
    notification_sender: null, email_subject: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", dati_estratti: {}
  }));
  const annunci_candidati_notifiche = [];
  for (let i = 0; i < history; i++) annunci_candidati_notifiche.push({ candidate_id: historyFor, source_email_id: "n" + String(i).padStart(5, "0"), notified_at: iso(i), created_at: iso(i), listing_price: 99000 });
  // Una notifica per ogni altro candidato
  annunci_candidati.forEach(row => { if (row.id !== historyFor) annunci_candidati_notifiche.push({ candidate_id: row.id, source_email_id: "x-" + row.id, notified_at: iso(1), created_at: iso(1), listing_price: 1 }); });
  return { annunci_candidati, annunci_candidati_notifiche };
}

let failures = 0;
function eq(actual, expected, message) {
  if (actual !== expected) { failures++; console.error("FAIL " + message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected)); }
  else console.log("ok   " + message);
}
const historyCount = (state, id) => state.cache.find(item => item.id === id)?.notification_history.length;
const panelHtml = env => env.dom.elements.candidateRecoveryList.innerHTML;

// 1) Errore nello storico notifiche al primo caricamento (prima lettura dello storico)
{
  const env = environment(dataset());
  env.control.fail = { table: "annunci_candidati_notifiche", call: 1 };
  const result = await env.api.loadCandidateRecovery();
  const state = env.api.state();
  eq(result, false, "primo caricamento con errore nello storico: esito negativo");
  eq(state.cache.length, 0, "primo caricamento con errore: nessun dato salvato come completo");
  eq(state.loadedAt, 0, "primo caricamento con errore: nessuna data di caricamento completo");
  eq(state.index.length, 0, "primo caricamento con errore: indice degli scartati non sostituito da dati parziali");
  eq(/Storico notifiche degli scartati non disponibile/.test(state.error || ""), true, "primo caricamento con errore: errore registrato");
  eq(env.messages.at(-1).type, "error", "primo caricamento con errore: messaggio di errore mostrato");
  env.api.renderCandidateRecovery();
  eq(/non caricati/.test(panelHtml(env)) && panelHtml(env).includes('id="candidateRecoveryRetry"'), true, "primo caricamento con errore: pannello con errore e pulsante Riprova");
  eq(panelHtml(env).includes("data-recovery-item"), false, "primo caricamento con errore: nessuna scheda mostrata");
  // Riprova (stesso gestore collegato dal pannello)
  env.tick(60000);
  eq(typeof env.dom.listeners.candidateRecoveryRetry, "function", "pulsante Riprova collegato");
  await env.dom.listeners.candidateRecoveryRetry({ currentTarget: {} });
  const after = env.api.state();
  eq(after.error, null, "Riprova riuscito: errore rimosso");
  eq(after.loadedAt, Date.parse("2026-11-26T09:01:00Z"), "Riprova riuscito: data dell'ultimo caricamento completo aggiornata");
  eq(historyCount(after, "d001"), 1500, "Riprova riuscito: storico completo (1500 notifiche su due pagine)");
  eq(panelHtml(env).includes("data-recovery-error"), false, "Riprova riuscito: avviso rimosso dal pannello");
  eq(env.messages.at(-1).type, "success", "Riprova riuscito: il messaggio di errore viene sostituito");
}

// 2) Errore dopo almeno una pagina di storico letta, con una cache valida precedente
{
  const db = dataset();
  const env = environment(db);
  eq(await env.api.loadCandidateRecovery(), true, "cache iniziale: caricamento completo");
  const before = env.api.state();
  const cacheBefore = before.cache, loadedBefore = before.loadedAt, snapshot = JSON.stringify(before.cache);
  db.annunci_candidati_notifiche.push({ candidate_id: "d001", source_email_id: "nuova", notified_at: iso(5000), created_at: iso(5000), listing_price: 98000 });
  env.tick(5 * 60000);
  env.control.counts = {};
  env.control.fail = { table: "annunci_candidati_notifiche", call: 2 }; // la prima pagina (1000 notifiche) riesce, la seconda fallisce
  eq(await env.api.loadCandidateRecovery(), false, "errore alla seconda pagina dello storico: esito negativo");
  const after = env.api.state();
  eq(after.cache === cacheBefore && JSON.stringify(after.cache) === snapshot, true, "errore alla seconda pagina: cache precedente mai sovrascritta");
  eq(historyCount(after, "d001"), 1500, "errore alla seconda pagina: nessuno storico parziale (non 1000)");
  eq(after.loadedAt, loadedBefore, "errore alla seconda pagina: data dell'ultimo caricamento completo invariata");
  env.api.renderCandidateRecovery();
  const htmlAfter = panelHtml(env);
  eq(/Dati non aggiornati/.test(htmlAfter) && htmlAfter.includes('id="candidateRecoveryRetry"'), true, "errore con cache: avviso «Dati non aggiornati» e Riprova");
  eq(htmlAfter.includes(new Date(loadedBefore).toLocaleString("it-IT")), true, "errore con cache: indicata la data dell'ultimo caricamento completo");
  eq(htmlAfter.includes('data-recovery-item="d001"'), true, "errore con cache: le schede dell'ultimo caricamento restano visibili");
  // Riprova riuscito: nuova cache
  env.tick(60000);
  await env.dom.listeners.candidateRecoveryRetry({ currentTarget: {} });
  const retried = env.api.state();
  eq(retried.cache !== cacheBefore, true, "Riprova riuscito: la cache viene sostituita");
  eq(historyCount(retried, "d001"), 1501, "Riprova riuscito: la nuova notifica è presente");
  eq(retried.loadedAt > loadedBefore, true, "Riprova riuscito: data del caricamento completo aggiornata");
  eq(retried.error, null, "Riprova riuscito: errore rimosso");
}

// 3) Errore dopo che è stato letto almeno un gruppo di candidati (gruppi da 100)
{
  const db = dataset({ candidates: 230, historyFor: "d001", history: 3 });
  const env = environment(db);
  eq(await env.api.loadCandidateRecovery(), true, "230 scartati: caricamento completo iniziale (3 gruppi)");
  const before = env.api.state();
  const cacheBefore = before.cache, loadedBefore = before.loadedAt;
  eq(before.cache.length, 230, "230 scartati letti");
  env.tick(5 * 60000);
  env.control.counts = {};
  env.control.fail = { table: "annunci_candidati_notifiche", call: 3 }; // gruppo 1: pagina + fine pagine; il gruppo 2 fallisce
  eq(await env.api.loadCandidateRecovery(), false, "errore nel secondo gruppo di candidati: esito negativo");
  const after = env.api.state();
  eq(after.cache, cacheBefore, "errore nel secondo gruppo: cache precedente conservata");
  eq(after.loadedAt, loadedBefore, "errore nel secondo gruppo: data invariata");
  eq(after.cache.every(item => item.notification_history.length > 0), true, "errore nel secondo gruppo: nessun candidato con storico vuoto per effetto del guasto");
  eq(env.control.calls.filter(table => table === "annunci_candidati_notifiche").length > 0, true, "il guasto è avvenuto durante la lettura dello storico");
}

// 4) Errore nella lettura degli scartati stessi (dopo la prima pagina): nessun salvataggio
{
  const db = dataset({ candidates: 1205, historyFor: "d001", history: 2 });
  const env = environment(db);
  eq(await env.api.loadCandidateRecovery(), true, "1205 scartati: caricamento completo iniziale (due pagine)");
  const before = env.api.state();
  eq(before.cache.length, 1205, "1205 scartati letti oltre il limite di 1000 righe");
  env.tick(5 * 60000);
  env.control.counts = {};
  env.control.fail = { table: "annunci_candidati", call: 2 }; // la prima pagina di 1000 scartati riesce, la seconda fallisce
  eq(await env.api.loadCandidateRecovery(), false, "errore alla seconda pagina degli scartati: esito negativo");
  const after = env.api.state();
  eq(after.cache === before.cache && after.cache.length === 1205, true, "errore negli scartati: cache precedente conservata (non 1000)");
  eq(after.index === before.index, true, "errore negli scartati: indice degli scartati non sostituito");
  eq(after.loadedAt, before.loadedAt, "errore negli scartati: data invariata");
  eq(env.control.counts.annunci_candidati_notifiche || 0, 0, "errore negli scartati: lo storico non viene nemmeno letto");
  eq(/Impossibile leggere gli annunci scartati/.test(after.error || ""), true, "errore negli scartati: errore registrato per il pannello");
}

if (failures) { console.error(failures + " test non superati"); process.exit(1); }
console.log("Tutti i test di loadCandidateRecovery superati.");
