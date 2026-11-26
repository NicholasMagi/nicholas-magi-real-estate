// Recupero degli annunci di un'email Subito di ricerca salvata. Rete e database sono
// iniettati (deps), così il comportamento è verificabile nei test senza rete.
//
// Esiti:
//  - "completo": nuovi annunci individuati con certezza → una riga per annuncio, con il
//    proprio URL diretto e la propria chiave (ID Subito);
//  - "da_verificare": pagina letta ma nuovi annunci non individuabili con certezza → la
//    notifica resta come candidato "da verificare" con gli annunci plausibili;
//  - "errore": link mancante, pagina bloccata, vuota, errore di rete o HTTP → la notifica
//    resta come candidato "da verificare" e, salvo il link mancante, viene ritentata.
import { canonicalListingKey, bedrooms, bathrooms, extractAdditionalPropertyDetails, propertyType } from "./parser.ts";
import { DATA_EXTRACTION_VERSION, SELLER_CLASSIFICATION_VERSION } from "./retention.ts";
import type { SellerResult } from "./retention.ts";
import {
  identifyNewSubitoListings, isBlockedSubitoPage, normalizeSubitoSearchUrl, parseSubitoResultsPage, subitoSearchKey, SUBITO_REASON_TEXT
} from "./subito.ts";
import type { NewListingsDecision, SubitoDigest, SubitoItem, SubitoPage } from "./subito.ts";

export const SUBITO_MAX_ATTEMPTS = 6;
export const SUBITO_PAGE_MAX_BYTES = 3_000_000;
/** Pagine di risultati lette al massimo in un ciclo; le altre email vengono rinviate. */
export const SUBITO_MAX_PAGES_PER_RUN = 8;

export type SubitoEmail = { id: string; from?: unknown; subject?: unknown; date?: unknown };

export type SubitoAcquisitionDeps = {
  /** GET della pagina pubblica; solleva un errore per rete o tempo scaduto. */
  fetchPage(url: string): Promise<{ status: number; finalUrl: string; html: string }>;
  /** Data (ISO) dell'email precedente della stessa ricerca già acquisita, o null. */
  previousDigestDate(searchKey: string, beforeIso: string): Promise<string | null>;
  /** Candidato della stessa email già salvato da un ciclo precedente (tentativi), o null. */
  existingDigest(gmailId: string): Promise<{ dati_estratti?: unknown } | null>;
};

export type SubitoAcquisition = {
  status: "completo" | "da_verificare" | "errore";
  reason: string;
  /** Nuovi annunci individuati con certezza (non ancora confrontati con l'archivio). */
  items: SubitoItem[];
  decision: NewListingsDecision | null;
  pageSource: SubitoPage["source"] | null;
  pageCount: number;
  attempts: number;
  retry: boolean;
  /** true se va salvata (o aggiornata) la riga della notifica riepilogativa. */
  keepDigestRecord: boolean;
};

function emailIso(value: unknown): string | null {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function previousAttempts(existing: { dati_estratti?: unknown } | null): number {
  // deno-lint-ignore no-explicit-any
  const value = Number((existing?.dati_estratti as any)?.ricerca_subito?.tentativi);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function acquireSubitoDigest(
  email: SubitoEmail,
  digest: SubitoDigest,
  deps: SubitoAcquisitionDeps,
  options: { batchPreviousIso?: string | null; deferred?: boolean } = {}
): Promise<SubitoAcquisition> {
  const existing = await deps.existingDigest(String(email.id));
  // Rinvio per limite di letture nel ciclo: non conta come tentativo.
  if (options.deferred) {
    const attemptsSoFar = previousAttempts(existing);
    return { status: "errore", reason: "rinviato", items: [], decision: null, pageSource: null, pageCount: 0,
      attempts: attemptsSoFar, retry: true, keepDigestRecord: true };
  }
  const attempts = previousAttempts(existing) + 1;
  const receivedAt = emailIso(email.date);
  const fail = (reason: string, retryable: boolean): SubitoAcquisition => ({
    status: "errore", reason, items: [], decision: null, pageSource: null, pageCount: 0, attempts,
    retry: retryable && attempts < SUBITO_MAX_ATTEMPTS, keepDigestRecord: true
  });
  // Schede già presenti nell'email: non serve la pagina per sapere quali sono nuove.
  const fromEmailOnly = digest.emailListingUrls.length > 0 && digest.declaredCount === digest.emailListingUrls.length;

  let page: SubitoPage | null = null;
  let pageError: string | null = null;
  if (!digest.searchUrl) {
    if (!fromEmailOnly) return fail("link_mancante", false);
  } else {
    try {
      const response = await deps.fetchPage(digest.searchUrl);
      const finalSearchUrl = normalizeSubitoSearchUrl(response.finalUrl);
      // Un redirect verso un'altra ricerca Subito (per esempio con filtri persi) non è
      // una risposta valida: non dobbiamo classificare annunci di una ricerca diversa.
      // kxconfid e i parametri di ordinamento restano irrilevanti per l’identità della ricerca.
      const finalOk = !!finalSearchUrl && subitoSearchKey(finalSearchUrl) === digest.searchKey;
      if (isBlockedSubitoPage(response.status, response.html)) pageError = "pagina_bloccata";
      else if (response.status < 200 || response.status >= 300) pageError = "errore_http";
      else if (!finalOk) pageError = "pagina_vuota";
      else {
        page = parseSubitoResultsPage(response.html.slice(0, SUBITO_PAGE_MAX_BYTES));
        if (page.status === "bloccata") pageError = "pagina_bloccata";
        else if (page.status === "vuota") pageError = "pagina_vuota";
      }
    } catch {
      pageError = "errore_rete";
    }
  }
  if (pageError && !fromEmailOnly) return fail(pageError, true);

  let previousDigestIso: string | null = null;
  if (digest.searchKey && receivedAt) {
    previousDigestIso = await deps.previousDigestDate(digest.searchKey, receivedAt);
    const batch = options.batchPreviousIso ? Date.parse(options.batchPreviousIso) : NaN;
    if (Number.isFinite(batch) && batch < Date.parse(receivedAt) && (!previousDigestIso || batch > Date.parse(previousDigestIso))) {
      previousDigestIso = new Date(batch).toISOString();
    }
  }
  const decision = identifyNewSubitoListings({
    declaredCount: digest.declaredCount,
    page: pageError ? null : page,
    emailListingUrls: digest.emailListingUrls,
    emailDateIso: receivedAt,
    previousDigestIso
  });
  if (!decision.certain) {
    return {
      status: "da_verificare", reason: decision.reason, items: [], decision, pageSource: page?.source ?? null,
      pageCount: page?.items.length ?? 0, attempts, retry: false, keepDigestRecord: true
    };
  }
  return {
    status: "completo", reason: decision.reason, items: decision.newItems, decision, pageSource: page?.source ?? null,
    pageCount: page?.items.length ?? 0, attempts, retry: false,
    // La riga riepilogativa serve solo se esiste già (un tentativo precedente non riuscito):
    // viene aggiornata come "completata" per lasciare traccia dell'esito.
    keepDigestRecord: !!existing
  };
}

// ---------- Righe dei candidati (stessa forma delle righe costruite in index.ts) ----------

export type SubitoRowContext = {
  owner: string;
  email: SubitoEmail;
  digest: SubitoDigest;
  classifySeller(text: string): SellerResult;
  nowIso: string;
};

/** Identificativo della notifica di un singolo annuncio (unico per email e annuncio). */
export function subitoNotificationId(gmailId: string, adId: string): string {
  return gmailId + "#subito-" + adId;
}

/** La ricerca salvata filtra per "Privato", ma non è una prova sul singolo annuncio. */
function itemSeller(item: SubitoItem, classify: (text: string) => SellerResult): SellerResult {
  const fromText = classify([item.title, item.description].filter(Boolean).join(" "));
  if (fromText.classification === "Agenzia") return fromText;
  if (item.advertiserCompany === true) {
    return { classification: "Da verificare", confidence: 0, evidence: "Subito indica un inserzionista professionale: controllo manuale necessario" };
  }
  return fromText;
}

export function subitoItemRow(item: SubitoItem, ctx: SubitoRowContext, details: { pageSource: string | null }) {
  const gmailId = String(ctx.email.id);
  const receivedAt = emailIso(ctx.email.date);
  const text = [item.title, item.description].filter(Boolean).join(" ");
  const seller = itemSeller(item, ctx.classifySeller);
  const title = item.title || "Annuncio Subito " + item.id;
  const notificationId = subitoNotificationId(gmailId, item.id);
  const campi = {
    titolo: title, comune: item.location, prezzo: item.price, tipologia: propertyType(text),
    superficie_mq: item.surfaceMq, locali: item.rooms, camere: bedrooms(text), bagni: bathrooms(text)
  };
  return {
    owner_id: ctx.owner,
    titolo: title,
    comune: item.location,
    prezzo: item.price,
    explicit_price_reduction: null,
    tipologia_immobile: campi.tipologia,
    superficie_mq: item.surfaceMq,
    locali: item.rooms,
    camere: campi.camere,
    bagni: campi.bagni,
    dati_estratti: {
      ...extractAdditionalPropertyDetails(text),
      riduzione_prezzo: null,
      campi_immobile: campi,
      subito: {
        id: item.id,
        url: item.url,
        pubblicato_il: item.publishedAt,
        descrizione: item.description,
        immagini: item.images,
        inserzionista_professionale: item.advertiserCompany,
        ricerca: ctx.digest.searchKey,
        url_ricerca: ctx.digest.searchUrl,
        fonte_dati: details.pageSource || "email",
        dettagli_completi: details.pageSource === "next_data"
      }
    },
    dati_fonte: {
      provider: "Gmail · Subito ricerca salvata",
      source_email_id: gmailId,
      received_at: receivedAt,
      sender: String(ctx.email.from || "").slice(0, 300) || null,
      subject: String(ctx.email.subject || "").slice(0, 500) || null,
      ricerca_subito: ctx.digest.searchKey,
      url_ricerca: ctx.digest.searchUrl,
      annunci_dichiarati: ctx.digest.declaredCount,
      captured_at: ctx.nowIso
    },
    data_extraction_version: DATA_EXTRACTION_VERSION,
    tipo_venditore: seller.classification,
    seller_confidence: seller.confidence,
    seller_evidence: seller.evidence,
    seller_classification_version: SELLER_CLASSIFICATION_VERSION,
    notification_sender: String(ctx.email.from || "").slice(0, 300) || null,
    email_subject: String(ctx.email.subject || "").slice(0, 500) || null,
    portale: "subito.it",
    url: item.url,
    url_originale: ctx.digest.searchUrl,
    // Stessa semantica delle altre righe: data dell'email (ricezione della notifica).
    data_pubblicazione: receivedAt,
    source_email_id: notificationId,
    dedup_key: "subito:" + item.id,
    listing_key: canonicalListingKey(item.url),
    deduplication_version: 1,
    stato: "da_verificare",
    // Campi interni, non colonne del database (rimossi prima dell'inserimento).
    notification_source_id: notificationId,
    subito_ad_id: item.id,
    preserve_existing: true
  };
}

export function subitoDigestRow(ctx: SubitoRowContext, result: SubitoAcquisition, inserted: Array<{ id: string; url: string; title: string | null }> = []) {
  const gmailId = String(ctx.email.id);
  const receivedAt = emailIso(ctx.email.date);
  const declared = ctx.digest.declaredCount;
  const label = ctx.digest.searchLabel || "ricerca salvata";
  const titleSuffix = result.status === "completo"
    ? (declared ? declared + " nuovi annunci recuperati" : "annunci recuperati")
    : (declared ? declared + " nuovi annunci da verificare" : "nuovi annunci da verificare");
  const possible = (result.decision?.possibleItems || []).map(item => ({
    id: item.id, url: item.url, titolo: item.title, prezzo: item.price, localita: item.location, pubblicato_il: item.publishedAt
  }));
  return {
    owner_id: ctx.owner,
    titolo: ("Ricerca salvata Subito · " + label + " · " + titleSuffix).slice(0, 250),
    comune: null,
    prezzo: null,
    explicit_price_reduction: null,
    tipologia_immobile: null,
    superficie_mq: null,
    locali: null,
    camere: null,
    bagni: null,
    dati_estratti: {
      riduzione_prezzo: null,
      campi_immobile: {},
      ricerca_subito: {
        stato: result.status,
        motivo: result.reason,
        testo: SUBITO_REASON_TEXT[result.reason] || result.reason,
        annunci_dichiarati: declared,
        annunci_nella_pagina: result.pageCount,
        annunci_in_finestra: result.decision?.windowCount ?? null,
        fonte_pagina: result.pageSource,
        url_ricerca: ctx.digest.searchUrl,
        link_non_riconosciuto: ctx.digest.unresolvedLink,
        chiave: ctx.digest.searchKey,
        tentativi: result.attempts,
        nuovo_tentativo: result.retry,
        ultimo_tentativo: ctx.nowIso,
        possibili: possible,
        recuperati: inserted
      }
    },
    dati_fonte: {
      provider: "Gmail · Subito ricerca salvata",
      source_email_id: gmailId,
      received_at: receivedAt,
      sender: String(ctx.email.from || "").slice(0, 300) || null,
      subject: String(ctx.email.subject || "").slice(0, 500) || null,
      ricerca_subito: ctx.digest.searchKey,
      url_ricerca: ctx.digest.searchUrl,
      annunci_dichiarati: declared,
      captured_at: ctx.nowIso
    },
    // Versione più bassa = la sincronizzazione rilegge l'email al ciclo successivo
    // (stesso meccanismo di rielaborazione già usato per i link da correggere).
    data_extraction_version: result.retry ? DATA_EXTRACTION_VERSION - 1 : DATA_EXTRACTION_VERSION,
    // Un riepilogo di ricerca non è un annuncio: mai "Privato" (niente archiviazione automatica).
    tipo_venditore: "Da verificare" as const,
    seller_confidence: 0,
    seller_evidence: "Email riepilogativa di una ricerca salvata Subito: non riguarda un singolo annuncio",
    seller_classification_version: SELLER_CLASSIFICATION_VERSION,
    notification_sender: String(ctx.email.from || "").slice(0, 300) || null,
    email_subject: String(ctx.email.subject || "").slice(0, 500) || null,
    portale: "subito.it",
    url: null,
    url_originale: ctx.digest.searchUrl,
    data_pubblicazione: receivedAt,
    source_email_id: gmailId,
    dedup_key: "gmail:" + gmailId,
    listing_key: null,
    deduplication_version: 1,
    stato: "da_verificare",
    notification_source_id: gmailId,
    subito_ad_id: null,
    preserve_existing: false
  };
}

// ---------- Ciclo delle email Subito (usato da index.ts e dai test) ----------

// deno-lint-ignore no-explicit-any
export type SubitoDbClient = { from(table: string): any };

/** Letture del database necessarie al recupero (stesse query in produzione e nei test). */
export function supabaseSubitoDeps(
  admin: SubitoDbClient,
  owner: string,
  fetchPage: SubitoAcquisitionDeps["fetchPage"]
): SubitoAcquisitionDeps {
  return {
    fetchPage,
    async previousDigestDate(searchKey, beforeIso) {
      const { data, error } = await admin
        .from("annunci_candidati")
        .select("data_pubblicazione")
        .eq("owner_id", owner)
        .eq("dati_fonte->>ricerca_subito", searchKey)
        .lt("data_pubblicazione", beforeIso)
        .order("data_pubblicazione", { ascending: false })
        .limit(1);
      if (error) throw new Error("Lettura delle notifiche precedenti della ricerca Subito non riuscita");
      return data?.[0]?.data_pubblicazione ? String(data[0].data_pubblicazione) : null;
    },
    async existingDigest(gmailId) {
      const { data, error } = await admin
        .from("annunci_candidati")
        .select("id,dati_estratti")
        .eq("owner_id", owner)
        .eq("dedup_key", "gmail:" + gmailId)
        .maybeSingle();
      if (error) throw new Error("Lettura della notifica Subito già registrata non riuscita");
      return data || null;
    }
  };
}

export type SubitoCycleResult = {
  // deno-lint-ignore no-explicit-any
  rows: any[];
  failures: Array<{ sourceEmailId: string; reason: string }>;
  outcomes: Record<string, number>;
};

/**
 * Righe da salvare per le email Subito di ricerca salvata del ciclo, dalla più vecchia
 * alla più recente (l'email precedente della stessa ricerca delimita la finestra). Un
 * errore di database su un'email viene restituito in failures: il cursore non avanza.
 */
export async function subitoRowsForEmails(
  entries: Array<{ email: SubitoEmail; digest: SubitoDigest }>,
  deps: SubitoAcquisitionDeps,
  ctx: { owner: string; classifySeller(text: string): SellerResult; now?: () => string; maxPages?: number }
): Promise<SubitoCycleResult> {
  const now = ctx.now || (() => new Date().toISOString());
  const maxPages = ctx.maxPages ?? SUBITO_MAX_PAGES_PER_RUN;
  const result: SubitoCycleResult = { rows: [], failures: [], outcomes: {} };
  const lastBySearch = new Map<string, string>();
  const received = (value: unknown) => { const time = Date.parse(String(value || "")); return Number.isFinite(time) ? time : 0; };
  let pagesRead = 0;
  for (const { email, digest } of [...entries].sort((a, b) => received(a.email.date) - received(b.email.date))) {
    try {
      const needsPage = !!digest.searchUrl;
      const deferred = needsPage && pagesRead >= maxPages;
      if (needsPage && !deferred) pagesRead++;
      const acquisition = await acquireSubitoDigest(email, digest, deps, {
        batchPreviousIso: digest.searchKey ? lastBySearch.get(digest.searchKey) ?? null : null,
        deferred
      });
      const key = acquisition.status + ":" + acquisition.reason;
      result.outcomes[key] = (result.outcomes[key] || 0) + 1;
      const rowContext: SubitoRowContext = { owner: ctx.owner, email, digest, classifySeller: ctx.classifySeller, nowIso: now() };
      for (const item of acquisition.items) result.rows.push(subitoItemRow(item, rowContext, { pageSource: acquisition.pageSource }));
      if (acquisition.keepDigestRecord) {
        result.rows.push(subitoDigestRow(rowContext, acquisition, acquisition.items.map(item => ({ id: item.id, url: item.url, title: item.title }))));
      }
      if (digest.searchKey && received(email.date)) lastBySearch.set(digest.searchKey, new Date(received(email.date)).toISOString());
    } catch (error) {
      result.failures.push({ sourceEmailId: String(email.id), reason: error instanceof Error ? error.message.slice(0, 160) : "errore sconosciuto" });
    }
  }
  return result;
}
