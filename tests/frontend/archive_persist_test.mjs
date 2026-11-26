// Test della scrittura protetta di prepareCandidateForArchive() (index.html):
// la preparazione all'archiviazione non deve riscrivere dati_estratti o i campi
// dell'annuncio partendo dalla copia in memoria, cancellando ciò che la
// sincronizzazione Gmail ha scritto nel frattempo. Uso: node tests/frontend/archive_persist_test.mjs
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
  for (let index = html.indexOf("){", start) + 1; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}

let failures = 0;
function eq(actual, expected, message) {
  if (actual !== expected) { failures++; console.error("FAIL " + message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected)); }
  else console.log("ok   " + message);
}

// Database simulato: una riga di annunci_candidati; afterRead simula la sincronizzazione
// che scrive tra la lettura e la scrittura del frontend.
function harness(dbRow, { enrichment = null, afterRead = null } = {}) {
  const state = { row: structuredClone(dbRow), writes: 0, rejected: 0, afterRead };
  const supabase = {
    functions: { invoke: async () => enrichment ? { data: enrichment, error: null } : { data: null, error: { message: "non disponibile" } } },
    from() {
      const q = { filters: [], op: "select", patch: null, single: false };
      const b = {
        select() { return b; },
        eq(column, value) { q.filters.push(r => String(r[column]) === String(value)); return b; },
        is(column, value) { q.filters.push(r => (r[column] ?? null) === value); return b; },
        maybeSingle() { q.single = true; return b; },
        update(patch) { q.op = "update"; q.patch = patch; return b; },
        then(resolve) {
          const match = q.filters.every(f => f(state.row));
          if (q.op === "update") {
            if (match) { Object.assign(state.row, structuredClone(q.patch)); state.writes++; } else state.rejected++;
            resolve({ data: match ? [{ id: state.row.id }] : [], error: null });
            return;
          }
          const data = match ? structuredClone(state.row) : null;
          if (match && state.afterRead) state.afterRead(state.row);
          resolve({ data, error: null });
        }
      };
      return b;
    }
  };
  const fn = new Function("supabase", "currentUser",
    'const NMRE_CONFLICT_MESSAGE="L’annuncio è stato modificato nel frattempo";' +
    ["validUrl", "prepareCandidateForArchive"].map(grab).join("\n") + ";return prepareCandidateForArchive;")(supabase, { id: "u1" });
  return { run: (candidate, fields) => fn(candidate, fields), state };
}

// Copia in memoria (caricata fino a 60 secondi prima) e record attuale nel database.
const cached = {
  id: "c1", owner_id: "u1", titolo: "Trilocale", comune: "Ancona", prezzo: 150000, tipologia_immobile: "Appartamento",
  superficie_mq: 90, locali: 3, camere: 2, bagni: 1, contatto: null, portale: "immobiliare.it",
  url: "https://www.immobiliare.it/annunci/123456/", url_originale: null, updated_at: "2026-11-26T09:00:00.000Z",
  dati_estratti: { storico_stato: [{ data: "2026-11-25T10:00:00Z", origine: "utente", azione: "riportato_in_revisione" }] }
};
const syncedDb = {
  ...structuredClone(cached),
  prezzo: 140000, // nuova email con ribasso registrata dalla sincronizzazione
  updated_at: "2026-11-26T09:00:30.000Z",
  dati_estratti: { campi_immobile: { prezzo: 140000 }, storico_stato: [...cached.dati_estratti.storico_stato,
    { data: "2026-11-26T09:00:30Z", origine: "sincronizzazione", azione: "conservato_non_riconosciuto" }] }
};
const cardFields = { titolo: "Trilocale", comune: "Ancona Centro", prezzo: "150000", tipologia_immobile: "Appartamento", superficie_mq: "90", locali: "3", camere: "2", bagni: "1", contatto: "" };
const enrichment = { success: true, final_url: "https://www.immobiliare.it/annunci/123456/", retrieved_at: "2026-11-26T09:01:00Z", evidence: "Metadati pubblici", suggestions: { comune: "Ancona" } };

// 1) Analisi della pagina: lo storico scritto dalla sincronizzazione resta
{
  const h = harness(syncedDb, { enrichment });
  const result = await h.run(cached, cardFields);
  const actions = h.state.row.dati_estratti.storico_stato.map(e => e.azione).join(",");
  eq(result.persisted, true, "analisi della pagina: dati salvati");
  eq(actions, "riportato_in_revisione,conservato_non_riconosciuto", "analisi della pagina: storico della sincronizzazione conservato");
  eq(h.state.row.dati_estratti.campi_immobile?.prezzo, 140000, "analisi della pagina: dati estratti dalla sincronizzazione conservati");
  eq(h.state.row.dati_estratti.pagina_pubblica?.evidenza, "Metadati pubblici", "analisi della pagina: pagina pubblica aggiunta");
  eq(h.state.row.prezzo, 140000, "campo non modificato dall'utente: vale il prezzo aggiornato dalla sincronizzazione, non la copia in memoria");
  eq(h.state.row.comune, "Ancona Centro", "campo modificato dall'utente: vale il valore inserito");
}

// 2) Conflitto: la sincronizzazione scrive tra la lettura e la scrittura del frontend
{
  let syncWrites = 0;
  const h = harness(syncedDb, {
    enrichment,
    afterRead: row => {
      if (syncWrites++ > 0) return;
      row.dati_estratti = { ...row.dati_estratti, storico_stato: [...row.dati_estratti.storico_stato,
        { data: "2026-11-26T09:00:45Z", origine: "sincronizzazione", azione: "nuova_notifica_dopo_scarto", source_email_id: "m9" }] };
      row.updated_at = "2026-11-26T09:00:45.000Z";
    }
  });
  const result = await h.run(cached, cardFields);
  eq(result.persisted, true, "conflitto: salvataggio riuscito dopo la rilettura");
  eq(h.state.rejected, 1, "conflitto: la prima scrittura è stata respinta dal controllo su updated_at");
  eq(h.state.row.dati_estratti.storico_stato.at(-1)?.source_email_id, "m9", "conflitto: la voce scritta dalla sincronizzazione nel frattempo resta");
  eq(h.state.row.dati_estratti.pagina_pubblica?.evidenza, "Metadati pubblici", "conflitto: pagina pubblica salvata");
}

// 3) Conflitto persistente: nessuna scrittura, messaggio di conflitto
{
  let n = 0;
  const h = harness(syncedDb, { enrichment, afterRead: row => { row.updated_at = "2026-11-26T09:01:0" + (n++) + ".000Z"; } });
  const result = await h.run(cached, cardFields);
  eq(result.persisted, false, "conflitto persistente: nessun salvataggio");
  eq(h.state.writes, 0, "conflitto persistente: nessuna scrittura applicata");
  eq(h.state.rejected, 3, "conflitto persistente: tentativi limitati a 3");
  eq(/modificato nel frattempo/.test(result.error || ""), true, "conflitto persistente: messaggio di conflitto");
}

// 4) Senza link: solo i campi, sempre dal valore attuale per quelli non modificati
{
  const h = harness({ ...syncedDb, url: null }, {});
  const result = await h.run({ ...cached, url: null }, cardFields);
  eq(result.persisted, true, "senza link: dati salvati");
  eq(h.state.row.prezzo, 140000, "senza link: prezzo aggiornato dalla sincronizzazione conservato");
  eq(h.state.row.dati_estratti.storico_stato.length, 2, "senza link: dati_estratti non toccato");
}

// 5) Campi corretti a mano (audit punto 5): registrati in campi_manuali, senza perdere
// quelli registrati in precedenza né lo storico.
{
  const prior = { ...syncedDb, dati_estratti: { ...syncedDb.dati_estratti, campi_manuali: ["titolo"] } };
  const h = harness(prior, { enrichment });
  await h.run({ ...cached, dati_estratti: prior.dati_estratti }, { ...cardFields, superficie_mq: "95" });
  eq((h.state.row.dati_estratti.campi_manuali || []).join(","), "titolo,comune,superficie_mq", "campi corretti a mano registrati, anche quelli precedenti");
  eq(h.state.row.dati_estratti.storico_stato.length, 2, "campi manuali: storico conservato");
  const untouched = harness(syncedDb, {});
  await untouched.run({ ...cached, url: null }, { ...cardFields, comune: "Ancona" });
  eq(untouched.state.row.dati_estratti.campi_manuali, undefined, "nessun campo modificato: nessun campo manuale registrato");
}

if (failures) { console.error(failures + " test non superati"); process.exit(1); }
console.log("Tutti i test della preparazione all'archiviazione superati.");
