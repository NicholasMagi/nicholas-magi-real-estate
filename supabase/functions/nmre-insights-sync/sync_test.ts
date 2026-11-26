// Ricerca, paginazione e confronto con NMRE (sync.ts, usato da index.ts) con un'API
// simulata che risponde con l'involucro documentato (_metadata.pages, total_count,
// items). Gli annunci sono sintetici, costruiti sulla struttura dell'esempio documentato
// di fullSearchByAttribute; non sono risposte reali del provider.
import {
  classifyExistingByListingId, collectInsightsListings, INSIGHTS_MAX_PAGES_PER_SEARCH, planInsightsWrites
} from "./sync.ts";
import type { ExistingCandidate, InsightsApi } from "./sync.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected));
}
const DOC_ITEM = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/documented_full_search_example.json", import.meta.url))).risposta.items[0];
const TOWNS = ["Osimo", "Ancona", "Castelfidardo", "Loreto", "Recanati", "Camerano", "Numana", "Sirolo", "Jesi", "Porto Sant’Elpidio"];
/** n-esimo annuncio sintetico: ID annuncio 200000000 + n, UUID derivato. */
function item(n: number, overrides: Record<string, Any> = {}) {
  const base = structuredClone(DOC_ITEM);
  return {
    ...base, uuid: "uuid-" + n, clientType: "Privato",
    listingUrl: "https://www.immobiliare.it/annunci/" + (200000000 + n) + "/",
    location: { ...base.location, municipality: TOWNS[n % TOWNS.length], province: "Ancona", region: "Marche" },
    extra: { ...base.extra, title: "Annuncio sintetico " + n },
    ...overrides
  };
}
type Call = { endpoint: string; body: Any };
/** API simulata: pagine da 5 secondo Pagination.page; phone = sottoinsieme con filtro recapito. */
function fakeApi(privates: Any[], options: { phone?: Any[]; failAt?: { search: "privati" | "recapito"; page: number; status?: number; throws?: boolean; invalid?: boolean }; totalOverride?: number; details?: Record<string, Any> } = {}) {
  const calls: Call[] = [];
  const detailCalls: string[] = [];
  const api: InsightsApi = {
    search(endpoint, body: Any) {
      calls.push({ endpoint, body });
      const isPhone = body.Filters.phoneNumberProvided === true;
      const list = isPhone ? (options.phone ?? []) : privates;
      const page = body.Pagination.page, limit = body.Pagination.limit;
      const fail = options.failAt;
      if (fail && fail.page === page && (fail.search === "recapito") === isPhone) {
        if (fail.throws) return Promise.reject(new TypeError("connection reset"));
        if (fail.invalid) return Promise.resolve({ status: 200, data: { message: "ok" } });
        return Promise.resolve({ status: fail.status ?? 500, data: { error: "internal_error" } });
      }
      const last = Math.max(1, Math.ceil(list.length / limit));
      const items = list.slice((page - 1) * limit, page * limit);
      return Promise.resolve({ status: 200, data: {
        _metadata: { page, limit, total_count: options.totalOverride ?? list.length, request_id: "req-" + page,
          pages: { first: 1, last, next: page < last ? page + 1 : null, previous: page > 1 ? page - 1 : null, self: page } },
        items
      } });
    },
    detailByListingId(listingId) {
      detailCalls.push(listingId);
      const data = options.details?.[listingId];
      return Promise.resolve(data ? { status: 200, data } : { status: 404, data: { error: "not_found" } });
    }
  };
  return { api, calls, detailCalls };
}
const NOW = new Date("2026-11-26T10:00:00Z");
const ctx = { ownerId: "u1", nowIso: "2026-11-26T10:00:00.000Z" };

Deno.test("privati: una sola chiamata per pagina (fullSearchByAttribute), nessuna chiamata di dettaglio per UUID", async () => {
  const { api, calls, detailCalls } = fakeApi([item(1), item(2), item(3)]);
  const collection = await collectInsightsListings(api, { now: NOW, lookbackDays: 30 });
  eq(collection.status, "completo", "ricerca completa");
  eq(collection.privateItems.size, 3, "3 annunci di privati in area");
  eq(calls.every(call => call.endpoint === "fullSearchByAttribute"), true, "endpoint con dettaglio completo");
  eq(calls.map(call => call.body.Filters.phoneNumberProvided), [null, true], "ricerca di tutti i privati, poi annotazione del filtro recapito");
  eq(calls.every(call => call.body.Filters.clientTypeID === 1 && call.body.Filters.contractTypeID === 1 && call.body.Filters.categoryTypeID === 1), true, "privati, vendita, residenziale");
  eq(detailCalls.length, 0, "nessuna seconda chiamata per annuncio");
});

Deno.test("paginazione oltre le prime 10 pagine: 73 annunci su 15 pagine letti tutti", async () => {
  const list = Array.from({ length: 73 }, (_v, n) => item(n + 1));
  const { api, calls } = fakeApi(list);
  const collection = await collectInsightsListings(api, { now: NOW, lookbackDays: 30 });
  eq(collection.status, "completo", "ricerca completa");
  eq(collection.searches[0].pagesRead, 15, "15 pagine lette");
  eq(collection.privateItems.size, 73, "nessun annuncio perso oltre il 50°");
  eq(calls.filter(call => call.body.Filters.phoneNumberProvided === null).map(call => call.body.Pagination.page).join(","), Array.from({ length: 15 }, (_v, n) => n + 1).join(","), "pagine 1–15 in ordine");
  eq(INSIGHTS_MAX_PAGES_PER_SEARCH >= 200, true, "limite di sicurezza ben oltre 10 pagine");
});

Deno.test("limite di pagine o di tempo: risultato parziale dichiarato, annunci letti comunque deduplicati", async () => {
  const list = Array.from({ length: 30 }, (_v, n) => item(n + 1));
  let collection = await collectInsightsListings(fakeApi(list).api, { now: NOW, lookbackDays: 30, maxPages: 3 });
  eq(collection.status, "parziale", "limite di pagine: parziale");
  eq(collection.searches[0].problems[0].code, "limite_pagine", "motivo");
  eq(collection.privateItems.size, 15, "15 annunci letti");
  let time = 0;
  collection = await collectInsightsListings(fakeApi(list).api, { now: NOW, lookbackDays: 30, timeBudgetMs: 2, clock: () => (time += 1) });
  eq(collection.status, "parziale", "tempo esaurito: parziale");
  eq(collection.searches[0].problems[0].code, "tempo_esaurito", "motivo");
  // total_count superiore agli annunci restituiti: parziale.
  collection = await collectInsightsListings(fakeApi([item(1), item(2)], { totalOverride: 9 }).api, { now: NOW, lookbackDays: 30 });
  eq([collection.status, collection.searches[0].problems[0].code], ["parziale", "conteggio_incompleto"], "conteggio dichiarato non coperto");
});

Deno.test("errori del provider: nessuna scrittura (HTTP, rete, risposta non valida, ricerca del recapito)", async () => {
  const list = Array.from({ length: 12 }, (_v, n) => item(n + 1));
  const cases: Array<[string, Any]> = [
    ["http_500", { search: "privati", page: 2, status: 500 }],
    ["http_401", { search: "privati", page: 1, status: 401 }],
    ["http_422", { search: "privati", page: 1, status: 422 }],
    ["errore_rete", { search: "privati", page: 3, throws: true }],
    ["risposta_non_valida", { search: "privati", page: 1, invalid: true }],
    ["http_403", { search: "recapito", page: 1, status: 403 }]
  ];
  for (const [code, failAt] of cases) {
    const collection = await collectInsightsListings(fakeApi(list, { phone: list.slice(0, 3), failAt }).api, { now: NOW, lookbackDays: 30 });
    eq(collection.status, "errore", code + ": errore");
    eq(collection.searches.at(-1)!.problems[0].code, code, code + ": motivo registrato");
    const plan = planInsightsWrites(collection, { candidates: [], archive: [] }, ctx);
    eq([plan.blocked, plan.inserts.length, plan.privateUpdateIds.length], [true, 0, 0], code + ": nessun inserimento né aggiornamento");
  }
});

Deno.test("filtro geografico: fuori area e professionisti dichiarati esclusi, risposte incomplete contate", async () => {
  const list = [
    item(1), item(2, { location: { municipality: "Milano" } }), item(3, { location: { municipality: "Pesaro" } }),
    item(4, { clientType: "Professionista" }), item(5, { uuid: undefined }), item(6, { listingUrl: null }), item(7, { location: { municipality: "Morro d’Alba" } })
  ];
  const collection = await collectInsightsListings(fakeApi(list).api, { now: NOW, lookbackDays: 30 });
  eq([...collection.privateItems.keys()], ["immobiliare.it/annunci/200000001", "immobiliare.it/annunci/200000007"], "solo annunci di privati in area");
  eq([collection.outOfArea, collection.declaredProfessional, collection.unusable], [2, 1, 2], "esclusi contati");
});

Deno.test("importazione: nuovi annunci di privati inseriti «Da verificare», anche senza filtro recapito", async () => {
  const list = [item(1), item(2), item(3)];
  const collection = await collectInsightsListings(fakeApi(list, { phone: [item(2)] }).api, { now: NOW, lookbackDays: 30 });
  const plan = planInsightsWrites(collection, { candidates: [], archive: [] }, ctx);
  eq(plan.inserts.length, 3, "tutti i privati in area, non solo quelli con filtro recapito");
  eq(plan.inserts.map(row => (row.dati_estratti as Any).insights.filtro_recapito_segnalato), [false, true, false], "filtro recapito annotato (ricerca completa)");
  eq(plan.inserts.every(row => row.stato === "da_verificare" && row.contatto === null && row.listing_key!.startsWith("immobiliare.it/annunci/")), true, "da verificare, nessun recapito inventato, chiave dell'immobile");
});

Deno.test("duplicati: annunci già presenti via Gmail, Subito o importazione precedente non reinseriti", async () => {
  const list = [item(1), item(2), item(3), item(4)];
  const collection = await collectInsightsListings(fakeApi(list).api, { now: NOW, lookbackDays: 30 });
  const candidates: ExistingCandidate[] = [
    // Gmail: stesso annuncio, link con parametri di tracciamento.
    { id: "g1", url: "https://www.immobiliare.it/annunci/200000001/?utm_source=alert", stato: "da_verificare", seller_manual_override: false },
    // Gmail: solo listing_key.
    { id: "g2", listing_key: "immobiliare.it/annunci/200000002", stato: "da_verificare", seller_manual_override: false },
    // Importazione Insights precedente (stesso UUID).
    { id: "i3", dedup_key: "insights:immobiliare:uuid-3", url: "https://www.immobiliare.it/annunci/200000003/", stato: "da_verificare", seller_manual_override: false },
    // Subito: altro portale, ID diverso (non confrontabile con Immobiliare.it).
    { id: "s1", url: "https://www.subito.it/appartamenti/trilocale-osimo-669796300.htm", listing_key: "subito.it/appartamenti/trilocale-osimo-669796300.htm", stato: "da_verificare", seller_manual_override: false }
  ];
  const plan = planInsightsWrites(collection, { candidates, archive: [] }, ctx);
  eq(plan.inserts.map(row => row.listing_key), ["immobiliare.it/annunci/200000004"], "inserito solo l'annuncio nuovo");
  eq(plan.alreadyPresent, 3, "3 già presenti");
  eq(plan.privateUpdateIds.sort(), ["g1", "g2", "i3"], "candidati in attesa confermati come privati (solo campi del venditore)");
});

Deno.test("scartati, archiviati, Archivio manuale e decisioni manuali: mai riaperti, duplicati o modificati", async () => {
  const list = [item(1), item(2), item(3), item(4), item(5), item(6)];
  const collection = await collectInsightsListings(fakeApi(list).api, { now: NOW, lookbackDays: 30 });
  const candidates: ExistingCandidate[] = [
    { id: "x1", url: "https://www.immobiliare.it/annunci/200000001/", stato: "scartato", seller_manual_override: false },
    { id: "x2", url: "https://www.immobiliare.it/annunci/200000002/", stato: "confermato", seller_manual_override: false },
    { id: "x3", url: "https://www.immobiliare.it/annunci/200000003/", stato: "da_verificare", seller_manual_override: true }
  ];
  const archive = [
    { id: "a4", url: "https://www.immobiliare.it/annunci/200000004/", listing_key: null, deleted_at: null },
    { id: "a5", url: null, listing_key: "immobiliare.it/annunci/200000005", deleted_at: "2026-11-20T10:00:00Z" }
  ];
  const plan = planInsightsWrites(collection, { candidates, archive }, ctx);
  eq(plan.inserts.map(row => row.listing_key), ["immobiliare.it/annunci/200000006"], "inserito solo l'annuncio mai visto");
  eq(plan.privateUpdateIds, [], "nessun aggiornamento su scartati, archiviati o verificati a mano");
  eq([plan.untouchedDecisions, plan.untouchedManual], [2, 1], "decisioni e verifiche manuali lasciate intatte");
  eq(plan.archived.map(entry => entry.key + ":" + entry.eliminato), ["immobiliare.it/annunci/200000004:false", "immobiliare.it/annunci/200000005:true"], "Archivio (anche eliminati) riconosciuto");
});

Deno.test("ricerca parziale: annunci letti inseriti solo dopo il confronto completo con NMRE; filtro recapito non noto", async () => {
  const list = Array.from({ length: 20 }, (_v, n) => item(n + 1));
  const collection = await collectInsightsListings(fakeApi(list, { phone: list }).api, { now: NOW, lookbackDays: 30, maxPages: 2 });
  eq(collection.status, "parziale", "parziale");
  const plan = planInsightsWrites(collection, { candidates: [{ id: "g1", url: "https://www.immobiliare.it/annunci/200000001/", stato: "da_verificare", seller_manual_override: false }], archive: [] }, ctx);
  eq([plan.blocked, plan.inserts.length], [false, 9], "10 annunci letti, 1 già presente, 9 inseriti");
  eq(plan.inserts.every(row => (row.dati_estratti as Any).insights.filtro_recapito_segnalato !== false), true, "filtro recapito mai dichiarato assente se la ricerca è parziale");
});

Deno.test("professionisti: candidati già presenti verificati sul dettaglio per ID, mai inseriti né scartati", async () => {
  const details = {
    "300000001": { ...structuredClone(DOC_ITEM), clientType: "Professionista" },
    "300000002": { ...structuredClone(DOC_ITEM), clientType: "Privato" },
    "300000003": { ...structuredClone(DOC_ITEM), clientType: null }
  };
  const { api, detailCalls } = fakeApi([], { details });
  const rows: ExistingCandidate[] = [
    { id: "e1", url: "https://www.immobiliare.it/annunci/300000001/", stato: "da_verificare", seller_manual_override: false },
    { id: "e2", url: "https://www.immobiliare.it/annunci/300000002/", stato: "da_verificare", seller_manual_override: false },
    { id: "e3", url: "https://www.immobiliare.it/annunci/300000003/", stato: "da_verificare", seller_manual_override: false },
    { id: "e4", url: "https://www.immobiliare.it/annunci/300000004/", stato: "da_verificare", seller_manual_override: false },
    { id: "m1", url: "https://www.immobiliare.it/annunci/300000005/", stato: "da_verificare", seller_manual_override: true },
    { id: "s1", url: "https://www.immobiliare.it/annunci/300000006/", stato: "scartato", seller_manual_override: false },
    { id: "v1", url: "https://www.immobiliare.it/annunci/300000007/", stato: "da_verificare", seller_manual_override: false, seller_evidence: "Immobiliare.it Insights: già verificato" }
  ];
  const output = await classifyExistingByListingId(api, rows, { exclude: new Set() });
  eq(detailCalls, ["300000001", "300000002", "300000003", "300000004"], "solo candidati in attesa, non verificati a mano e non già verificati");
  eq(output.results, [{ id: "e1", clientType: "Professionista" }, { id: "e2", clientType: "Privato" }], "tipo dichiarato; null e 404 senza esito");
  eq(output.failed, 1, "annuncio non trovato (404) contato");
});
