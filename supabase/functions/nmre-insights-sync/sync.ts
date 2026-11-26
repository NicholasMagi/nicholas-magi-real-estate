// Ricerca degli annunci di privati su Immobiliare.it Insights e decisione su cosa
// scrivere in NMRE. Rete (api) e dati già presenti sono passati dall'esterno: lo stesso
// codice è usato da index.ts e dai test, senza rete.
//
// Regole:
//  - si usa fullSearchByAttribute: dettaglio completo di ogni risultato, nessuna
//    seconda chiamata per UUID (documentato solo per dati Asking, cioè gli annunci);
//  - la paginazione segue _metadata.pages fino all'ultima pagina, con un limite di
//    sicurezza e un tempo massimo: se non si arriva in fondo il risultato è "parziale";
//  - qualsiasi errore della ricerca (HTTP, rete, risposta non valida) rende il risultato
//    "errore": nessun inserimento e nessun aggiornamento;
//  - un annuncio già presente (Opportunità, Scartati, Archiviati, Gmail, Subito) non
//    viene mai reinserito né riaperto; le decisioni manuali non vengono toccate;
//  - un immobile già nell'Archivio (tabella annunci, anche inserito a mano o eliminato)
//    non viene duplicato in Opportunità.
import { immobiliareListingKey, buildInsightsSearchPayload, toCandidate, declaredClientType, isAllowedMunicipality } from "./provider.ts";
import type { InsightsCandidate } from "./provider.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type InsightsApi = {
  /** POST /comparables/<endpoint>; solleva un errore per rete o tempo scaduto. */
  search(endpoint: "fullSearchByAttribute", body: unknown): Promise<{ status: number; data: Any }>;
  /** GET /comparable/id/<listingId> (dettaglio da ID dell'annuncio, solo dati Asking). */
  detailByListingId(listingId: string): Promise<{ status: number; data: Any }>;
};

export const INSIGHTS_MAX_PAGES_PER_SEARCH = 200;
export const INSIGHTS_TIME_BUDGET_MS = 110_000;

export type SearchProblem = { search: string; code: string; detail?: string };
export type SearchOutcome = {
  label: string;
  /** "completo": tutte le pagine lette; "parziale": limite di pagine o di tempo; "errore": ricerca non riuscita. */
  status: "completo" | "parziale" | "errore";
  pagesRead: number;
  totalCount: number | null;
  itemsRead: number;
  problems: SearchProblem[];
};

export type InsightsCollection = {
  status: "completo" | "parziale" | "errore";
  searches: SearchOutcome[];
  /** Annunci di privati in area, per chiave dell'immobile (immobiliare.it/annunci/<id>). */
  privateItems: Map<string, { item: Any; requestId: string | null }>;
  /** Chiavi restituite anche dalla ricerca con phoneNumberProvided=true. */
  phoneFlagged: Set<string>;
  phoneSearchComplete: boolean;
  outOfArea: number;
  unusable: number;
  declaredProfessional: number;
};

function worst(a: SearchOutcome["status"], b: SearchOutcome["status"]): SearchOutcome["status"] {
  if (a === "errore" || b === "errore") return "errore";
  if (a === "parziale" || b === "parziale") return "parziale";
  return "completo";
}

async function runSearch(
  api: InsightsApi,
  label: string,
  build: (page: number) => unknown,
  onItems: (items: Any[], requestId: string | null) => void,
  limits: { maxPages: number; deadline: number; clock: () => number }
): Promise<SearchOutcome> {
  const outcome: SearchOutcome = { label, status: "completo", pagesRead: 0, totalCount: null, itemsRead: 0, problems: [] };
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    if (page > limits.maxPages) {
      outcome.status = "parziale";
      outcome.problems.push({ search: label, code: "limite_pagine", detail: "lette " + (page - 1) + " pagine" });
      return outcome;
    }
    if (limits.clock() > limits.deadline) {
      outcome.status = "parziale";
      outcome.problems.push({ search: label, code: "tempo_esaurito", detail: "lette " + (page - 1) + " pagine" });
      return outcome;
    }
    let response: { status: number; data: Any };
    try {
      response = await api.search("fullSearchByAttribute", build(page));
    } catch (error) {
      outcome.status = "errore";
      outcome.problems.push({ search: label, code: "errore_rete", detail: error instanceof Error ? error.message.slice(0, 120) : undefined });
      return outcome;
    }
    if (response.status !== 200) {
      outcome.status = "errore";
      outcome.problems.push({ search: label, code: "http_" + response.status, detail: String(response.data?.error || response.data?.message || "").slice(0, 120) || undefined });
      return outcome;
    }
    const data = response.data;
    if (!data || typeof data !== "object" || !Array.isArray(data.items) || !data._metadata || typeof data._metadata !== "object") {
      outcome.status = "errore";
      outcome.problems.push({ search: label, code: "risposta_non_valida" });
      return outcome;
    }
    outcome.pagesRead++;
    const total = Number(data._metadata.total_count);
    if (Number.isFinite(total)) outcome.totalCount = total;
    for (const item of data.items) if (typeof item?.uuid === "string") seen.add(item.uuid);
    outcome.itemsRead += data.items.length;
    onItems(data.items, typeof data._metadata.request_id === "string" ? data._metadata.request_id : null);
    const pages = data._metadata.pages || {};
    const last = Number(pages.last);
    const hasNext = pages.next !== null && pages.next !== undefined && (!Number.isFinite(last) || page < last);
    if (!data.items.length || !hasNext) break;
  }
  // Tutte le pagine lette: il numero di annunci distinti deve coprire il totale dichiarato.
  if (outcome.totalCount !== null && seen.size < outcome.totalCount) {
    outcome.status = "parziale";
    outcome.problems.push({ search: label, code: "conteggio_incompleto", detail: seen.size + " di " + outcome.totalCount });
  }
  return outcome;
}

/**
 * Due ricerche sullo stesso periodo e area: tutti i privati (clientTypeID=1) e i privati
 * con il filtro phoneNumberProvided=true (solo per annotare il filtro sull'annuncio).
 */
export async function collectInsightsListings(
  api: InsightsApi,
  options: { now: Date; lookbackDays: number; maxPages?: number; timeBudgetMs?: number; clock?: () => number }
): Promise<InsightsCollection> {
  const clock = options.clock || (() => Date.now());
  const limits = { maxPages: options.maxPages ?? INSIGHTS_MAX_PAGES_PER_SEARCH, deadline: clock() + (options.timeBudgetMs ?? INSIGHTS_TIME_BUDGET_MS), clock };
  const collection: InsightsCollection = {
    status: "completo", searches: [], privateItems: new Map(), phoneFlagged: new Set(), phoneSearchComplete: false,
    outOfArea: 0, unusable: 0, declaredProfessional: 0
  };
  const privates = await runSearch(api, "privati",
    page => buildInsightsSearchPayload(options.now, options.lookbackDays, page, 1, null),
    (items, requestId) => {
      for (const item of items) {
        const key = immobiliareListingKey(item?.listingUrl);
        if (!key || typeof item?.uuid !== "string" || !item.uuid) { collection.unusable++; continue; }
        if (!isAllowedMunicipality(item?.location?.municipality)) { collection.outOfArea++; continue; }
        if (declaredClientType(item) === "Professionista") { collection.declaredProfessional++; continue; }
        if (!collection.privateItems.has(key)) collection.privateItems.set(key, { item, requestId });
      }
    }, limits);
  collection.searches.push(privates);
  if (privates.status === "errore") {
    collection.status = "errore";
    return collection;
  }
  const phone = await runSearch(api, "privati con filtro recapito",
    page => buildInsightsSearchPayload(options.now, options.lookbackDays, page, 1, true),
    items => {
      for (const item of items) {
        const key = immobiliareListingKey(item?.listingUrl);
        if (key) collection.phoneFlagged.add(key);
      }
    }, limits);
  collection.searches.push(phone);
  collection.phoneSearchComplete = phone.status === "completo";
  collection.status = worst(privates.status, phone.status);
  return collection;
}

// ---------- Confronto con quanto già presente in NMRE ----------

export type ExistingCandidate = {
  id: string; url?: string | null; url_originale?: string | null; listing_key?: string | null; dedup_key?: string | null;
  stato?: string | null; seller_manual_override?: boolean | null; seller_evidence?: string | null; seller_classification_version?: number | null;
};
export type ArchivedListing = { id: string; url?: string | null; listing_key?: string | null; deleted_at?: string | null };

export function candidateKeys(row: ExistingCandidate): string[] {
  const keys = new Set<string>();
  for (const value of [row.listing_key ? "https://www." + row.listing_key : null, row.url, row.url_originale]) {
    const key = immobiliareListingKey(value);
    if (key) keys.add(key);
  }
  return [...keys];
}

export type InsightsPlan = {
  inserts: InsightsCandidate[];
  /** Candidati già presenti, in attesa e senza verifica manuale: venditore privato confermato dall'API. */
  privateUpdateIds: string[];
  alreadyPresent: number;
  untouchedDecisions: number;
  untouchedManual: number;
  archived: Array<{ key: string; annuncioId: string; eliminato: boolean }>;
  /** Nessuna scrittura: ricerca non riuscita. */
  blocked: boolean;
};

export function planInsightsWrites(
  collection: InsightsCollection,
  existing: { candidates: ExistingCandidate[]; archive: ArchivedListing[] },
  context: { ownerId: string; nowIso: string }
): InsightsPlan {
  const plan: InsightsPlan = { inserts: [], privateUpdateIds: [], alreadyPresent: 0, untouchedDecisions: 0, untouchedManual: 0, archived: [], blocked: false };
  if (collection.status === "errore") {
    plan.blocked = true;
    return plan;
  }
  const byKey = new Map<string, ExistingCandidate[]>();
  const byDedup = new Map<string, ExistingCandidate>();
  for (const row of existing.candidates) {
    for (const key of candidateKeys(row)) byKey.set(key, [...(byKey.get(key) || []), row]);
    if (row.dedup_key) byDedup.set(String(row.dedup_key), row);
  }
  const archiveByKey = new Map<string, ArchivedListing>();
  for (const row of existing.archive) {
    for (const value of [row.listing_key ? "https://www." + row.listing_key : null, row.url]) {
      const key = immobiliareListingKey(value);
      if (key && !archiveByKey.has(key)) archiveByKey.set(key, row);
    }
  }
  const updateIds = new Set<string>();
  for (const [key, { item, requestId }] of collection.privateItems) {
    const phoneFlag = collection.phoneFlagged.has(key) ? true : (collection.phoneSearchComplete ? false : null);
    const candidate = toCandidate(item, { ownerId: context.ownerId, clientTypeID: 1, phoneFlag, requestId, nowIso: context.nowIso });
    if (!candidate) continue;
    const matches = [...(byKey.get(key) || [])];
    const byUuid = byDedup.get(candidate.dedup_key);
    if (byUuid && !matches.includes(byUuid)) matches.push(byUuid);
    if (matches.length) {
      plan.alreadyPresent++;
      for (const row of matches) {
        if (row.seller_manual_override === true) plan.untouchedManual++;
        else if (row.stato === "da_verificare") updateIds.add(String(row.id));
        else plan.untouchedDecisions++;
      }
      continue;
    }
    const archived = archiveByKey.get(key);
    if (archived) {
      plan.archived.push({ key, annuncioId: String(archived.id), eliminato: !!archived.deleted_at });
      continue;
    }
    plan.inserts.push(candidate);
  }
  plan.privateUpdateIds = [...updateIds];
  return plan;
}

// ---------- Candidati già presenti: tipo di inserzionista dal dettaglio per ID ----------

export const INSIGHTS_MAX_DETAIL_CHECKS = 30;

/**
 * Per i candidati in attesa (non verificati a mano) con un link Immobiliare.it e senza
 * esito Insights, legge il dettaglio per ID annuncio (GET /comparable/id/<id>) e ne
 * ricava il tipo di inserzionista dichiarato. Sostituisce la ricerca di tutti i
 * professionisti dell'area, che richiederebbe migliaia di pagine.
 */
export async function classifyExistingByListingId(
  api: InsightsApi,
  candidates: ExistingCandidate[],
  options: { exclude: Set<string>; max?: number; deadline?: number; clock?: () => number }
): Promise<{ results: Array<{ id: string; clientType: "Privato" | "Professionista" }>; checked: number; failed: number; skippedForTime: number }> {
  const clock = options.clock || (() => Date.now());
  const pending = candidates.filter(row =>
    row.stato === "da_verificare" && row.seller_manual_override !== true && !options.exclude.has(String(row.id)) &&
    !String(row.seller_evidence || "").startsWith("Immobiliare.it Insights") && candidateKeys(row).length > 0);
  const output = { results: [] as Array<{ id: string; clientType: "Privato" | "Professionista" }>, checked: 0, failed: 0, skippedForTime: 0 };
  for (const row of pending.slice(0, options.max ?? INSIGHTS_MAX_DETAIL_CHECKS)) {
    if (options.deadline !== undefined && clock() > options.deadline) { output.skippedForTime++; continue; }
    const listingId = candidateKeys(row)[0].split("/").pop()!;
    try {
      const response = await api.detailByListingId(listingId);
      output.checked++;
      if (response.status !== 200 || !response.data || typeof response.data !== "object") { output.failed++; continue; }
      const declared = declaredClientType(response.data);
      if (declared) output.results.push({ id: String(row.id), clientType: declared });
    } catch {
      output.failed++;
    }
  }
  return output;
}
