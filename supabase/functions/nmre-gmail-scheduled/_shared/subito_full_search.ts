// Acquisizione dell'INTERA ricerca salvata Subito (NMRE_SUBITO_FULL_SEARCH=true).
//
// L'email di Subito è solo il segnale: si rilegge la ricerca salvata dal link del pulsante
// (stessi filtri, compreso quello sugli inserzionisti), pagina per pagina, e ogni annuncio
// non ancora presente in NMRE diventa una scheda in Nuove opportunità, con la normale
// notifica. Rete e database sono iniettati (deps): tutto è verificabile senza rete.
//
// Garanzie:
//  - nessun aggiramento di CAPTCHA o protezioni: una pagina bloccata è un errore registrato
//    e la ricerca resta in attesa di recupero (riga della notifica ritentata);
//  - la paginazione non è presunta: ogni pagina deve dichiarare il numero richiesto, e i
//    suoi annunci devono essere diversi da quelli già letti; altrimenti ci si ferma
//    («parziale») senza inventare nulla;
//  - deduplicazione prima di creare: ID Subito (dedup_key, listing_key, url) in Opportunità
//    e in Archivio; il confronto per comune, prezzo e superficie serve solo a segnalare un
//    possibile duplicato, mai a unire o scartare;
//  - un annuncio già presente non viene riscritto: si completano solo i campi vuoti;
//  - inserzionista: «Privato» solo se Subito lo indica per il singolo annuncio; un
//    professionista non è mai privato; se non è verificabile, «Da verificare»;
//  - idempotenza: la stessa email o la stessa ricerca rielaborata non crea doppioni (chiavi
//    uniche per annuncio e registro per email).
import { readSubitoResultsPage, subitoDigestRow, subitoItemRow, SUBITO_MAX_ATTEMPTS } from "./subito_acquisition.ts";
import type { SubitoAcquisition, SubitoAcquisitionDeps, SubitoDbClient, SubitoEmail, SubitoRowContext } from "./subito_acquisition.ts";
import { rowReferencesSubitoAd, subitoIdLikePatterns, subitoSearchPageUrl, SUBITO_REASON_TEXT } from "./subito.ts";
import { subitoNoAgencyExclusion } from "./subito_acquisition.ts";
import type { SubitoDigest, SubitoItem, SubitoPage } from "./subito.ts";
import type { SellerResult } from "./retention.ts";
import { municipality } from "./parser.ts";
import { isTargetMunicipality } from "../../_shared/territory.ts";

/** Pagine lette al massimo per una ricerca (30 annunci per pagina nella pagina reale). */
export const SUBITO_FULL_MAX_PAGES_PER_SEARCH = 10;
/** Pagine lette al massimo in un ciclo, per tutte le ricerche (limite di tempo della funzione). */
export const SUBITO_FULL_MAX_PAGES_PER_RUN = 12;
/**
 * Notifiche singole al massimo per sincronizzazione di una ricerca. Oltre (tipicamente la
 * prima sincronizzazione di una ricerca ampia, o la ripresa dopo un blocco) TUTTE le schede
 * vengono create comunque, contrassegnate con notifica_raggruppata (nessuna notifica per
 * scheda, condizione del trigger nella migrazione 20261126210000), e una sola scheda
 * riepilogativa della ricerca genera una notifica normale.
 */
export const SUBITO_FULL_MAX_SINGLE_NOTIFICATIONS = 10;
/** Pausa tra una pagina e la successiva della stessa ricerca (richieste non ravvicinate). */
export const SUBITO_FULL_PAGE_DELAY_MS = 1500;

export function subitoFullSearchEnabled(envValue: string | undefined): boolean {
  return String(envValue ?? "").trim().toLowerCase() === "true";
}

Object.assign(SUBITO_REASON_TEXT, {
  ricerca_completa: "Intera ricerca letta: tutte le pagine dichiarate da Subito",
  ricerca_parziale_limite: "Ricerca letta solo in parte: troppe pagine per un ciclo, il resto al prossimo tentativo",
  ricerca_parziale_bloccata: "Ricerca letta solo in parte: una pagina successiva è protetta o non raggiungibile (non aggirata)",
  paginazione_non_verificabile: "Subito non ha confermato il numero della pagina successiva: lettura fermata senza supposizioni",
  paginazione_ripetuta: "La pagina successiva ripete annunci già letti: lettura fermata",
  pagina_successiva_non_valida: "La pagina successiva non corrisponde alla ricerca (filtri diversi, per esempio sugli inserzionisti) o è vuota: lettura fermata",
  totale_non_dichiarato: "La pagina non dichiara quante pagine ha la ricerca: letti solo gli annunci mostrati",
  assorbita: "Ricerca aggiornata dall'email più recente della stessa ricerca nello stesso ciclo",
  notifica_raggruppata: "Molte nuove opportunità in una sola sincronizzazione: create tutte, con una sola notifica riepilogativa"
});

export type FullSearchFetch = {
  status: "completa" | "parziale" | "errore";
  reason: string;
  items: SubitoItem[];
  pagesRead: number;
  totalPages: number | null;
  totalDeclared: number | null;
  source: SubitoPage["source"] | null;
  /** Annunci di voci non leggibili (senza link valido) nelle pagine lette. */
  skipped: number;
};

/**
 * Legge tutte le pagine della ricerca. La prima pagina è quella del pulsante dell'email;
 * le successive aggiungono o=N e devono dichiarare di essere la pagina N.
 */
export async function fetchWholeSubitoSearch(
  digest: SubitoDigest,
  deps: Pick<SubitoAcquisitionDeps, "fetchPage"> & { sleep?: (ms: number) => Promise<void> },
  options: { maxPages: number }
): Promise<FullSearchFetch> {
  const base = { items: [] as SubitoItem[], pagesRead: 0, totalPages: null as number | null, totalDeclared: null as number | null, source: null as SubitoPage["source"] | null, skipped: 0 };
  if (!digest.searchUrl) return { ...base, status: "errore", reason: "link_mancante" };
  if (options.maxPages < 1) return { ...base, status: "errore", reason: "rinviato" };
  const first = await readSubitoResultsPage(digest.searchUrl, digest.searchUrl, digest.searchKey, deps.fetchPage);
  if (first.error === "pagina_vuota" && first.page?.status === "vuota" && first.page.total === 0) {
    // Ricerca che Subito dichiara vuota: esito completo con zero annunci (nessun errore).
    return { ...base, status: "completa", reason: "ricerca_completa", pagesRead: 1, totalPages: 0, totalDeclared: 0, source: first.page.source };
  }
  if (first.error || !first.page) return { ...base, status: "errore", reason: first.error || "pagina_vuota" };
  const page1 = first.page;
  const seen = new Map<string, SubitoItem>();
  for (const item of page1.items) if (!seen.has(item.id)) seen.set(item.id, item);
  const result: FullSearchFetch = {
    ...base, status: "completa", reason: "ricerca_completa", pagesRead: 1,
    totalPages: page1.totalPages ?? null, totalDeclared: page1.total ?? null, source: page1.source, skipped: page1.skipped || 0
  };
  const finish = (status: FullSearchFetch["status"], reason: string) => ({ ...result, status, reason, items: [...seen.values()] });
  if (page1.source !== "next_data") return finish("parziale", "struttura_non_riconosciuta");
  if (page1.totalPages === null || page1.totalPages === undefined) {
    // Senza numero di pagine si accetta solo il caso dimostrabile: tutti i risultati mostrati.
    return page1.total !== null && page1.total !== undefined && seen.size >= page1.total
      ? finish("completa", "ricerca_completa")
      : finish("parziale", "totale_non_dichiarato");
  }
  for (let number = 2; number <= page1.totalPages; number++) {
    if (result.pagesRead >= options.maxPages) return finish("parziale", "ricerca_parziale_limite");
    const url = subitoSearchPageUrl(digest.searchUrl, number);
    if (!url) return finish("parziale", "paginazione_non_verificabile");
    if (deps.sleep) await deps.sleep(SUBITO_FULL_PAGE_DELAY_MS);
    const next = await readSubitoResultsPage(url, digest.searchUrl, digest.searchKey, deps.fetchPage);
    if (next.error === "pagina_vuota") return finish("parziale", "pagina_successiva_non_valida");
    if (next.error || !next.page) return finish("parziale", "ricerca_parziale_bloccata");
    if (next.page.source !== "next_data" || next.page.pageNumber !== number) return finish("parziale", "paginazione_non_verificabile");
    result.pagesRead++;
    result.skipped += next.page.skipped || 0;
    const fresh = next.page.items.filter(item => !seen.has(item.id));
    if (!fresh.length) return finish("parziale", "paginazione_ripetuta");
    for (const item of fresh) seen.set(item.id, item);
  }
  return finish(result.skipped > 0 ? "parziale" : "completa", result.skipped > 0 ? "dati_parziali" : "ricerca_completa");
}

// ---------- Deduplicazione ----------

export type KnownListing = {
  /** Schede in Opportunità con lo stesso ID Subito (dedup_key, listing_key o url). */
  candidateIds: string[];
  /** Immobile nell'Archivio con lo stesso ID Subito (anche inserito a mano o nel cestino). */
  archive: { annuncioId: string; eliminato: boolean } | null;
};

export type FullSearchDeps = SubitoAcquisitionDeps & {
  sleep?: (ms: number) => Promise<void>;
  /** Tutte le schede in Opportunità con questo ID Subito (più di una = duplicato da unificare). */
  candidatesForAd(adId: string): Promise<string[]>;
  /**
   * Confronto secondario: schede Subito con ID DIVERSO ma stesso comune, prezzo e superficie.
   * Solo segnalazione («possibile duplicato»), mai unione o scarto.
   */
  similarCandidates(item: SubitoItem): Promise<Array<{ id: string; subitoId: string | null }>>;
};

export type ItemClassification =
  | { kind: "nuovo"; item: SubitoItem; possibleDuplicates: Array<{ id: string; subitoId: string | null }> }
  | { kind: "gia_in_opportunita"; item: SubitoItem; candidateIds: string[] }
  | { kind: "gia_in_archivio"; item: SubitoItem; annuncioId: string; eliminato: boolean };

/** Un errore di lettura interrompe l'email (ritentata): mai schede senza il confronto. */
export async function classifyFullSearchItems(items: SubitoItem[], deps: FullSearchDeps): Promise<ItemClassification[]> {
  const output: ItemClassification[] = [];
  for (const item of items) {
    const candidateIds = await deps.candidatesForAd(item.id);
    if (candidateIds.length) { output.push({ kind: "gia_in_opportunita", item, candidateIds }); continue; }
    const archive = await deps.archivedListing(item.id);
    if (archive) { output.push({ kind: "gia_in_archivio", item, annuncioId: archive.annuncioId, eliminato: archive.eliminato }); continue; }
    output.push({ kind: "nuovo", item, possibleDuplicates: await deps.similarCandidates(item) });
  }
  return output;
}

// ---------- Inserzionista ----------

/**
 * Filtro sugli inserzionisti letto dal link della ricerca (stessa regola dell'importatore
 * da browser in index.html): solo contesto registrato, mai una classificazione da solo.
 */
export function subitoSellerFilter(searchUrl: string | null): { status: "privati" | "non_privati" | "non_rilevato"; evidence: string } {
  let url: URL;
  try { url = new URL(String(searchUrl || "")); } catch { return { status: "non_rilevato", evidence: "Link della ricerca non leggibile" }; }
  const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
  const advt = (url.searchParams.get("advt") || "").split(",").map(value => value.trim()).filter(Boolean);
  if (advt.includes("1")) return { status: "non_privati", evidence: "La ricerca comprende inserzionisti aziendali (advt=" + advt.join(",") + ")" };
  if (segments.includes("da-aziende")) return { status: "non_privati", evidence: "La ricerca è limitata alle aziende (/da-aziende/)" };
  if (segments.includes("da-privati")) return { status: "privati", evidence: "Filtro privati nel link della ricerca (/da-privati/)" };
  if (advt.length && advt.every(value => value === "0" || value === "2")) return { status: "privati", evidence: "Filtro privati nel link della ricerca (advt=" + advt.join(",") + ")" };
  return { status: "non_rilevato", evidence: "Nessun filtro sugli inserzionisti nel link della ricerca" };
}

const PROFESSIONAL_HINT = /\b(?:agenzi[ae]|agente immobiliare|provvigion[ei]|mediazione|intermediazione|studio immobiliare|societ[aà] immobiliare|real estate|tecnocasa|tempocasa|gabetti|re\/?max|professionecasa|engel\s*&\s*v[oö]lkers|iad italia)\b/gi;
const NEGATED_HINT = /\b(?:no|niente|senza|astenersi|non\s+(?:si\s+)?accettano|esclus[ei]|non\s+tratto\s+con)\s+(?:le\s+|gli\s+|con\s+)?$/i;
/** Riferimenti professionali nel testo, escluse le negazioni («no agenzie», «astenersi agenzie»). */
export function professionalHint(text: string): boolean {
  const value = String(text || "");
  for (const match of value.matchAll(PROFESSIONAL_HINT)) {
    if (!NEGATED_HINT.test(value.slice(Math.max(0, (match.index || 0) - 40), match.index))) return true;
  }
  return false;
}

/**
 * Natura dell'inserzionista per l'intera ricerca. Il filtro della ricerca non è una prova
 * sul singolo annuncio: conta solo ciò che Subito indica per l'annuncio (advertiser.company).
 */
export function fullSearchSeller(item: SubitoItem, classify: (text: string) => SellerResult): SellerResult {
  const fromText = classify([item.title, item.description].filter(Boolean).join(" "));
  // Ricerca già filtrata per privati: nessuna esclusione come «Agenzia», resta in coda.
  if (fromText.classification === "Agenzia") return subitoNoAgencyExclusion(fromText);
  if (item.advertiserCompany === true) {
    return { classification: "Da verificare", confidence: 0, evidence: "Subito indica un inserzionista professionale: mai importato come privato, verifica manuale" };
  }
  if (item.advertiserCompany === false) {
    // Indicazione di Subito contraddetta dal testo (agenzia, provvigione, marchi): mai privato.
    if (professionalHint([item.title, item.description].filter(Boolean).join(" "))) {
      return { classification: "Da verificare", confidence: 0, evidence: "Subito indica un privato, ma il testo contiene riferimenti professionali (agenzia, provvigione o marchio): verifica manuale" };
    }
    return { classification: "Privato", confidence: 0.9, evidence: "Subito indica un inserzionista privato nei dati dell'annuncio" };
  }
  return { classification: "Da verificare", confidence: 0, evidence: "Subito non indica il tipo di inserzionista per questo annuncio: verifica manuale" };
}

// ---------- Righe e registro ----------

export type FullSearchLog = {
  owner_id: string;
  gmail_message_id: string;
  ricerca_chiave: string | null;
  ricerca_nome: string | null;
  url_ricerca: string | null;
  email_ricevuta_il: string | null;
  eseguita_il: string;
  esito: "completa" | "parziale" | "errore" | "assorbita";
  motivo: string;
  motivo_testo: string;
  pagine_lette: number;
  pagine_dichiarate: number | null;
  annunci_dichiarati_ricerca: number | null;
  annunci_trovati: number;
  nuove_opportunita: number;
  gia_in_opportunita: number;
  gia_in_archivio: number;
  da_verificare: number;
  professionali: number;
  possibili_duplicati: number;
  duplicati_da_unificare: number;
  /** true se le nuove schede non hanno notifiche singole ma una sola notifica riepilogativa. */
  notifica_raggruppata: boolean;
  tentativi: number;
  nuovo_tentativo: boolean;
  dettagli: Record<string, unknown>;
};

export type FullSearchCycleResult = {
  // deno-lint-ignore no-explicit-any
  rows: any[];
  logs: FullSearchLog[];
  failures: Array<{ sourceEmailId: string; reason: string }>;
  outcomes: Record<string, number>;
};

function emailIso(value: unknown): string | null {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function attemptsOf(existing: { dati_estratti?: unknown } | null): number {
  // deno-lint-ignore no-explicit-any
  const value = Number((existing?.dati_estratti as any)?.ricerca_subito?.tentativi);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Riga di una nuova scheda (o di un annuncio ritrovato) dall'intera ricerca. */
// deno-lint-ignore no-explicit-any
export function fullSearchItemRow(item: SubitoItem, ctx: SubitoRowContext, details: { pageSource: string | null; known: boolean; possibleDuplicates?: Array<{ id: string; subitoId: string | null }> }): any {
  // deno-lint-ignore no-explicit-any
  const row: any = subitoItemRow(item, { ...ctx, classifySeller: () => fullSearchSeller(item, ctx.classifySeller) }, { pageSource: details.pageSource });
  row.dati_estratti.subito.acquisizione = "intera_ricerca";
  if (details.possibleDuplicates?.length) {
    row.dati_estratti.subito.possibili_duplicati = details.possibleDuplicates.map(entry => ({ candidato_id: entry.id, subito_id: entry.subitoId }));
  }
  row.skip_auto_archive = true;
  // Annuncio già presente: nessun dato modificato (history_only da subitoItemRow); lo
  // storico registra solo un prezzo diverso dall'ultimo noto (sighting_only).
  if (details.known) row.sighting_only = true;
  return row;
}

/**
 * Righe da salvare e registro per le email Subito di ricerca salvata del ciclo. Per ogni
 * ricerca si legge una sola volta l'intera ricerca, dall'email più recente; le email più
 * vecchie della stessa ricerca nello stesso ciclo risultano «assorbite». Un errore di
 * database su un'email finisce in failures: il cursore Gmail non avanza.
 */
export async function subitoFullSearchRows(
  entries: Array<{ email: SubitoEmail; digest: SubitoDigest }>,
  deps: FullSearchDeps,
  ctx: { owner: string; classifySeller(text: string): SellerResult; now?: () => string; maxPagesPerRun?: number; maxPagesPerSearch?: number; maxSingleNotifications?: number; allowAutomatedPageFetch?: boolean }
): Promise<FullSearchCycleResult> {
  const now = ctx.now || (() => new Date().toISOString());
  let budget = ctx.maxPagesPerRun ?? SUBITO_FULL_MAX_PAGES_PER_RUN;
  const perSearch = ctx.maxPagesPerSearch ?? SUBITO_FULL_MAX_PAGES_PER_SEARCH;
  const result: FullSearchCycleResult = { rows: [], logs: [], failures: [], outcomes: {} };
  const received = (value: unknown) => { const time = Date.parse(String(value || "")); return Number.isFinite(time) ? time : 0; };
  // Più recente per prima: è quella che aggiorna la ricerca.
  const ordered = [...entries].sort((a, b) => received(b.email.date) - received(a.email.date));
  const latestBySearch = new Map<string, string>();
  for (const { email, digest } of ordered) if (digest.searchKey && !latestBySearch.has(digest.searchKey)) latestBySearch.set(digest.searchKey, String(email.id));
  const count = (key: string) => { result.outcomes[key] = (result.outcomes[key] || 0) + 1; };

  for (const { email, digest } of ordered) {
    const gmailId = String(email.id);
    try {
      const existing = await deps.existingDigest(gmailId);
      const rowContext: SubitoRowContext = { owner: ctx.owner, email, digest, classifySeller: ctx.classifySeller, nowIso: now() };
      const log: FullSearchLog = {
        owner_id: ctx.owner, gmail_message_id: gmailId, ricerca_chiave: digest.searchKey, ricerca_nome: digest.searchLabel,
        url_ricerca: digest.searchUrl, email_ricevuta_il: emailIso(email.date), eseguita_il: rowContext.nowIso,
        esito: "completa", motivo: "ricerca_completa", motivo_testo: "", pagine_lette: 0, pagine_dichiarate: null,
        annunci_dichiarati_ricerca: null, annunci_trovati: 0, nuove_opportunita: 0, gia_in_opportunita: 0, gia_in_archivio: 0,
        da_verificare: 0, professionali: 0, possibili_duplicati: 0, duplicati_da_unificare: 0, notifica_raggruppata: false, tentativi: attemptsOf(existing),
        nuovo_tentativo: false, dettagli: {}
      };
      if (digest.searchKey && latestBySearch.get(digest.searchKey) !== gmailId) {
        // Email più vecchia della stessa ricerca: l'aggiornamento è quello dell'email più recente.
        log.esito = "assorbita"; log.motivo = "assorbita";
        log.dettagli = { email_piu_recente: latestBySearch.get(digest.searchKey) };
        log.motivo_testo = SUBITO_REASON_TEXT.assorbita;
        count("assorbita");
        result.logs.push(log);
        // Una notifica precedente in attesa di recupero viene chiusa dall'email più recente.
        if (existing) result.rows.push(subitoDigestRow(rowContext, { ...emptyAcquisition(), status: "completo", reason: "assorbita", attempts: log.tentativi }));
        continue;
      }
      const unauthorized = !!digest.searchUrl && ctx.allowAutomatedPageFetch !== true;
      const deferred = !!digest.searchUrl && budget < 1;
      const fetched = unauthorized
        ? { status: "errore" as const, reason: "autorizzazione_richiesta", items: [], pagesRead: 0, totalPages: null, totalDeclared: null, source: null, skipped: 0 }
        : deferred
        ? { status: "errore" as const, reason: "rinviato", items: [], pagesRead: 0, totalPages: null, totalDeclared: null, source: null, skipped: 0 }
        : await fetchWholeSubitoSearch(digest, deps, { maxPages: Math.min(perSearch, budget) });
      budget -= fetched.pagesRead || (deferred ? 0 : digest.searchUrl ? 1 : 0);
      const attempts = deferred || unauthorized ? log.tentativi : log.tentativi + 1;
      const retry = !unauthorized && fetched.status !== "completa" && fetched.reason !== "link_mancante" && (deferred || attempts < SUBITO_MAX_ATTEMPTS);
      Object.assign(log, {
        esito: fetched.status, motivo: fetched.reason, motivo_testo: SUBITO_REASON_TEXT[fetched.reason] || fetched.reason,
        pagine_lette: fetched.pagesRead, pagine_dichiarate: fetched.totalPages, annunci_dichiarati_ricerca: fetched.totalDeclared,
        annunci_trovati: fetched.items.length, tentativi: attempts, nuovo_tentativo: retry
      });
      count(fetched.status + ":" + fetched.reason);

      const territoryItems = fetched.items.filter(item => { const town = municipality(String(item.location || "")); return !town || isTargetMunicipality(town); });
      const outsideTerritory = fetched.items.length - territoryItems.length;
      if (outsideTerritory) count("fuori_territorio");
      const classified = await classifyFullSearchItems(territoryItems, deps);
      const inserted: Array<{ id: string; url: string; title: string | null }> = [];
      const archived: SubitoAcquisition["archived"] = [];
      const toUnify: Array<{ subito_id: string; candidati: string[] }> = [];
      for (const entry of classified) {
        if (entry.kind === "gia_in_archivio") {
          log.gia_in_archivio++;
          archived.push({ id: entry.item.id, url: entry.item.url, title: entry.item.title, annuncio_id: entry.annuncioId, eliminato: entry.eliminato });
          continue;
        }
        const row = fullSearchItemRow(entry.item, rowContext, {
          pageSource: fetched.source, known: entry.kind === "gia_in_opportunita",
          possibleDuplicates: entry.kind === "nuovo" ? entry.possibleDuplicates : []
        });
        result.rows.push(row);
        if (entry.kind === "gia_in_opportunita") {
          log.gia_in_opportunita++;
          if (entry.candidateIds.length > 1) toUnify.push({ subito_id: entry.item.id, candidati: entry.candidateIds });
          continue;
        }
        log.nuove_opportunita++;
        inserted.push({ id: entry.item.id, url: entry.item.url, title: entry.item.title });
        if (row.tipo_venditore === "Da verificare") log.da_verificare++;
        if (entry.item.advertiserCompany === true) log.professionali++;
        if (entry.possibleDuplicates.length) log.possibili_duplicati++;
      }
      log.duplicati_da_unificare = toUnify.length;
      // Troppe nuove schede in una sincronizzazione: tutte create, nessuna notifica singola,
      // una sola notifica dalla scheda riepilogativa (creata qui sotto).
      const grouped = inserted.length > (ctx.maxSingleNotifications ?? SUBITO_FULL_MAX_SINGLE_NOTIFICATIONS);
      if (grouped) {
        log.notifica_raggruppata = true;
        const newIds = new Set(inserted.map(entry => entry.id));
        for (const row of result.rows) {
          if (row.subito_ad_id && newIds.has(row.subito_ad_id) && !row.sighting_only && row.dati_estratti?.subito?.acquisizione === "intera_ricerca"
            && row.dati_fonte?.source_email_id === gmailId) row.dati_estratti.subito.notifica_raggruppata = true;
        }
      }
      const sellerFilter = subitoSellerFilter(digest.searchUrl);
      log.dettagli = {
        filtro_venditore: sellerFilter.status,
        filtro_venditore_prova: sellerFilter.evidence,
        voci_non_leggibili: fetched.skipped,
        fuori_territorio: outsideTerritory,
        nuove: inserted.slice(0, 100),
        gia_in_archivio: archived.slice(0, 100).map(entry => ({ id: entry.id, annuncio_id: entry.annuncio_id, eliminato_dall_archivio: entry.eliminato })),
        duplicati_da_unificare: toUnify.slice(0, 50)
      };
      result.logs.push(log);
      // Riga della notifica: solo se serve un nuovo tentativo (ricerca in attesa di
      // recupero, visibile in Opportunità con il motivo) o se esisteva già (si chiude).
      if (fetched.status !== "completa" || existing || grouped) {
        const digestRow = subitoDigestRow(rowContext, {
          ...emptyAcquisition(),
          status: fetched.status === "completa" ? "completo" : fetched.status === "parziale" ? "da_verificare" : "errore",
          reason: fetched.status === "completa" && grouped ? "notifica_raggruppata" : fetched.reason,
          archived, pageSource: fetched.source, pageCount: fetched.items.length, attempts, retry
        }, inserted);
        if (grouped) {
          // Unica notifica della sincronizzazione: il titolo dice quante opportunità sono arrivate.
          const label = digest.searchLabel || "ricerca salvata";
          digestRow.titolo = ("Ricerca salvata Subito · " + label + " · " + inserted.length + " nuove opportunità"
            + (fetched.status === "completa" ? "" : " (lettura da completare)")).slice(0, 250);
          Object.assign(digestRow.dati_estratti.ricerca_subito, { notifica_raggruppata: true, nuove_opportunita: inserted.length, motivo_lettura: fetched.reason });
        }
        result.rows.push(digestRow);
      }
    } catch (error) {
      result.failures.push({ sourceEmailId: gmailId, reason: error instanceof Error ? error.message.slice(0, 160) : "errore sconosciuto" });
    }
  }
  return result;
}

function emptyAcquisition(): SubitoAcquisition {
  return { status: "completo", reason: "", items: [], decision: null, archived: [], proposals: [], pageSource: null, pageCount: 0, attempts: 0, retry: false, keepDigestRecord: true };
}

// ---------- Letture del database aggiuntive ----------

export function supabaseFullSearchDeps(admin: SubitoDbClient, owner: string, base: SubitoAcquisitionDeps, sleep?: (ms: number) => Promise<void>): FullSearchDeps {
  return {
    ...base,
    sleep,
    async candidatesForAd(adId) {
      if (!/^\d{6,}$/.test(adId)) return [];
      const ids = new Set<string>();
      const patterns = subitoIdLikePatterns(adId);
      for (const [column, method, pattern] of [
        ["dedup_key", "eq", "subito:" + adId] as const,
        ...patterns.listingKey.map(p => ["listing_key", "like", p] as const),
        ...patterns.url.map(p => ["url", "like", p] as const)
      ]) {
        const { data, error } = await admin.from("annunci_candidati").select("id,dedup_key,listing_key,url").eq("owner_id", owner)[method](column, pattern).limit(20);
        if (error) throw new Error("Confronto con le opportunità non riuscito");
        // Solo righe che si riferiscono davvero all'annuncio su subito.it (nessun dominio contraffatto).
        for (const row of data || []) if (rowReferencesSubitoAd(row, adId)) ids.add(String(row.id));
      }
      return [...ids];
    },
    async similarCandidates(item) {
      if (!item.location || !(Number(item.price) > 0)) return [];
      const { data, error } = await admin.from("annunci_candidati").select("id,listing_key,superficie_mq,dati_estratti")
        .eq("owner_id", owner).eq("portale", "subito.it").eq("comune", item.location).eq("prezzo", item.price).limit(20);
      if (error) throw new Error("Confronto secondario con le opportunità non riuscito");
      // deno-lint-ignore no-explicit-any
      return (data || []).map((row: any) => ({ id: String(row.id), subitoId: row.dati_estratti?.subito?.id ?? (String(row.listing_key || "").match(/-(\d{6,})\.htm$/)?.[1] ?? null), surface: row.superficie_mq }))
        .filter((row: { subitoId: string | null; surface: unknown }) => row.subitoId !== item.id
          && (item.surfaceMq === null || row.surface === null || row.surface === undefined || Number(row.surface) === item.surfaceMq))
        .map(({ id, subitoId }: { id: string; subitoId: string | null }) => ({ id, subitoId }));
    }
  };
}

/** Registro della sincronizzazione: una riga per email (rielaborazione = stessa riga). */
export async function saveFullSearchLogs(admin: SubitoDbClient, logs: FullSearchLog[]): Promise<void> {
  for (const log of logs) {
    const { error } = await admin.from("nmre_subito_ricerche_sync").upsert(log, { onConflict: "owner_id,gmail_message_id" });
    if (error) throw new Error("Registro della sincronizzazione Subito non salvato");
  }
}

// ---------- Unificazione sicura di due schede duplicate (solo piano, nessuna scrittura) ----------

/**
 * Piano di unificazione di due schede dello STESSO annuncio Subito (stesso ID). Non scrive
 * nulla: va mostrato al titolare e applicato solo dopo conferma esplicita. Nessun dato
 * perso: i campi vuoti della scheda principale si completano con quelli del duplicato, i
 * valori diversi restano nel piano come alternative, lo storico delle notifiche passa alla
 * principale e il duplicato non viene cancellato. Schede con ID diversi: nessun piano.
 */
// deno-lint-ignore no-explicit-any
export function planSubitoDuplicateMerge(primary: Record<string, any>, duplicate: Record<string, any>):
  { ok: true; primaryId: string; duplicateId: string; fill: Record<string, unknown>; conflicts: Record<string, { principale: unknown; duplicato: unknown }>; moveNotifications: boolean; deleteDuplicate: false }
  | { ok: false; reason: string } {
  const idOf = (row: Record<string, unknown>) => {
    // deno-lint-ignore no-explicit-any
    const data = row.dati_estratti as any;
    return String(data?.subito?.id || String(row.listing_key || "").match(/-(\d{6,})\.htm$/)?.[1] || String(row.dedup_key || "").match(/^subito:(\d{6,})$/)?.[1] || "") || null;
  };
  const a = idOf(primary), b = idOf(duplicate);
  if (!a || !b) return { ok: false, reason: "id_subito_mancante" };
  if (a !== b) return { ok: false, reason: "immobili_diversi" };
  if (String(primary.id) === String(duplicate.id)) return { ok: false, reason: "stessa_scheda" };
  const fill: Record<string, unknown> = {};
  const conflicts: Record<string, { principale: unknown; duplicato: unknown }> = {};
  const skip = new Set(["id", "owner_id", "created_at", "updated_at", "dedup_key", "listing_key", "source_email_id"]);
  for (const [key, value] of Object.entries(duplicate)) {
    if (skip.has(key) || value === null || value === undefined || value === "") continue;
    const current = primary[key];
    if (current === null || current === undefined || current === "") fill[key] = value;
    else if (JSON.stringify(current) !== JSON.stringify(value)) conflicts[key] = { principale: current, duplicato: value };
  }
  return { ok: true, primaryId: String(primary.id), duplicateId: String(duplicate.id), fill, conflicts, moveNotifications: true, deleteDuplicate: false };
}
