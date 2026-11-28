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
import { canonicalListingKey, bedrooms, bathrooms, extractAdditionalPropertyDetails, propertyType, municipality } from "./parser.ts";
import { isTargetMunicipality, territoryClassification } from "../../_shared/territory.ts";
import { DATA_EXTRACTION_VERSION, SELLER_CLASSIFICATION_VERSION } from "./retention.ts";
import type { SellerResult } from "./retention.ts";
import {
  identifyNewSubitoListings, isBlockedSubitoPage, normalizeSubitoSearchUrl, parseSubitoResultsPage, subitoPageConfirmsSearch, subitoSearchKey,
  SUBITO_REASON_TEXT
} from "./subito.ts";
import { rowReferencesSubitoAd, subitoIdLikePatterns } from "./subito.ts";
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
  /**
   * Immobile già nell'Archivio (tabella annunci, anche inserito a mano o nel cestino) con
   * questo ID Subito, o null. Solleva un errore se il confronto non riesce: in quel caso
   * nessun annuncio viene classificato come nuovo e l'email viene ritentata.
   */
  archivedListing(adId: string): Promise<{ annuncioId: string; eliminato: boolean } | null>;
  /** true se esiste già un candidato per questo ID Subito (gestito dal salvataggio). */
  knownCandidate(adId: string): Promise<boolean>;
};

export type SubitoAcquisition = {
  status: "completo" | "da_verificare" | "errore";
  reason: string;
  /** Nuovi annunci individuati con certezza (non ancora confrontati con l'archivio). */
  items: SubitoItem[];
  decision: NewListingsDecision | null;
  /** Annunci nuovi già presenti solo nell'Archivio: non inseriti, registrati nella notifica. */
  archived: Array<{ id: string; url: string; title: string | null; annuncio_id: string; eliminato: boolean }>;
  /**
   * Annunci plausibili la cui novità non è dimostrabile, proposti come schede singole
   * «Da verificare» (solo con itemCandidates attivo; esclusi quelli solo nell'Archivio).
   */
  proposals?: SubitoItem[];
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

/**
 * Lettura di una pagina dei risultati con tutte le verifiche: protezioni del sito (mai
 * aggirate), errori HTTP, redirect verso un'altra ricerca, pagina vuota. Condivisa dal
 * recupero dei soli annunci nuovi e da quello dell'intera ricerca.
 */
export async function readSubitoResultsPage(
  requestUrl: string,
  searchUrl: string,
  searchKey: string | null,
  fetchPage: SubitoAcquisitionDeps["fetchPage"]
): Promise<{ page: SubitoPage | null; error: string | null }> {
  try {
    const response = await fetchPage(requestUrl);
    const finalSearchUrl = normalizeSubitoSearchUrl(response.finalUrl);
    // Un redirect verso un'altra ricerca Subito (per esempio con filtri persi) non è
    // una risposta valida: non dobbiamo classificare annunci di una ricerca diversa.
    // kxconfid e i parametri di ordinamento restano irrilevanti per l’identità della ricerca.
    // Subito riscrive l'URL (reale: ?advt=0%2C2 → /da-privati/): se la pagina dichiara i
    // filtri applicati, vale il confronto con quelli; altrimenti il confronto delle chiavi.
    const confirmed = subitoPageConfirmsSearch(searchUrl, response.html);
    const finalOk = !!finalSearchUrl && (confirmed === true || (confirmed === null && subitoSearchKey(finalSearchUrl) === searchKey));
    if (isBlockedSubitoPage(response.status, response.html)) return { page: null, error: "pagina_bloccata" };
    if (response.status < 200 || response.status >= 300) return { page: null, error: "errore_http" };
    if (!finalOk) return { page: null, error: "pagina_vuota" };
    const page = parseSubitoResultsPage(response.html.slice(0, SUBITO_PAGE_MAX_BYTES));
    if (page.status === "bloccata") return { page: null, error: "pagina_bloccata" };
    if (page.status === "vuota") return { page, error: "pagina_vuota" };
    return { page, error: null };
  } catch {
    return { page: null, error: "errore_rete" };
  }
}

export async function acquireSubitoDigest(
  email: SubitoEmail,
  digest: SubitoDigest,
  deps: SubitoAcquisitionDeps,
  options: { batchPreviousIso?: string | null; deferred?: boolean; itemCandidates?: boolean; acquisitionEnabled?: boolean } = {}
): Promise<SubitoAcquisition> {
  const existing = await deps.existingDigest(String(email.id));
  // Default sicuro: nessuna lettura automatica delle pagine risultati senza autorizzazione scritta e abilitazione esplicita lato server.
  if (digest.searchUrl && options.acquisitionEnabled !== true) {
    return { status: "errore", reason: "autorizzazione_richiesta", items: [], decision: null, archived: [], proposals: [],
      pageSource: null, pageCount: 0, attempts: previousAttempts(existing), retry: false, keepDigestRecord: true };
  }
  // Rinvio per limite di letture nel ciclo: non conta come tentativo.
  if (options.deferred) {
    const attemptsSoFar = previousAttempts(existing);
    return { status: "errore", reason: "rinviato", items: [], decision: null, archived: [], proposals: [], pageSource: null, pageCount: 0,
      attempts: attemptsSoFar, retry: true, keepDigestRecord: true };
  }
  const attempts = previousAttempts(existing) + 1;
  const receivedAt = emailIso(email.date);
  const fail = (reason: string, retryable: boolean): SubitoAcquisition => ({
    status: "errore", reason, items: [], decision: null, archived: [], proposals: [], pageSource: null, pageCount: 0, attempts,
    retry: retryable && attempts < SUBITO_MAX_ATTEMPTS, keepDigestRecord: true
  });
  if (!digest.searchUrl) return fail("link_mancante", false);
  const read = await readSubitoResultsPage(digest.searchUrl, digest.searchUrl, digest.searchKey, deps.fetchPage);
  const page: SubitoPage | null = read.page;
  const pageError: string | null = read.error;
  if (pageError) return fail(pageError, true);

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
    // Con itemCandidates ogni annuncio plausibile diventa una scheda singola «Da verificare»
    // (nessun annuncio perso). Stesso confronto con l'Archivio degli annunci certi: un
    // errore interrompe l'email (ritentata, cursore fermo), mai schede senza confronto.
    const proposals: SubitoItem[] = [];
    const archivedUnproven: SubitoAcquisition["archived"] = [];
    if (options.itemCandidates) {
      for (const item of decision.plausibleItems ?? decision.possibleItems) {
        const inArchive = await deps.archivedListing(item.id);
        if (inArchive && !(await deps.knownCandidate(item.id))) {
          archivedUnproven.push({ id: item.id, url: item.url, title: item.title, annuncio_id: inArchive.annuncioId, eliminato: inArchive.eliminato });
        } else {
          proposals.push(item);
        }
      }
    }
    return {
      status: "da_verificare", reason: decision.reason, items: [], decision, archived: archivedUnproven, proposals,
      pageSource: page?.source ?? null, pageCount: page?.items.length ?? 0, attempts, retry: false, keepDigestRecord: true
    };
  }
  // Confronto con l'Archivio: un annuncio nuovo già archiviato senza candidato d'origine
  // (inserito a mano nella tabella annunci, o eliminato dall'Archivio) non viene
  // reinserito. Se esiste un candidato, ci pensa il salvataggio (nessun duplicato, la
  // notifica viene collegata). Un errore qui interrompe l'email: niente "nuovi" senza
  // il confronto con l'Archivio.
  const items: SubitoItem[] = [];
  const archived: SubitoAcquisition["archived"] = [];
  for (const item of decision.newItems) {
    const inArchive = await deps.archivedListing(item.id);
    if (inArchive && !(await deps.knownCandidate(item.id))) {
      archived.push({ id: item.id, url: item.url, title: item.title, annuncio_id: inArchive.annuncioId, eliminato: inArchive.eliminato });
    } else {
      items.push(item);
    }
  }
  return {
    status: "completo", reason: decision.reason, items, decision, archived, proposals: [], pageSource: page?.source ?? null,
    pageCount: page?.items.length ?? 0, attempts, retry: false,
    // La riga riepilogativa serve se esiste già (un tentativo precedente non riuscito) o
    // se un annuncio è stato riconosciuto nell'Archivio: resta traccia dell'esito.
    keepDigestRecord: !!existing || archived.length > 0
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

/**
 * La ricerca salvata filtra per "Privato", ma non è una prova sul singolo annuncio. Le
 * ricerche Subito sono già filtrate per privati: nessuna esclusione come «Agenzia» (che
 * toglierebbe l'annuncio dalla coda); segnali di agenzia nel testo → «Da verificare».
 */
export function subitoNoAgencyExclusion(result: SellerResult): SellerResult {
  if (result.classification !== "Agenzia") return result;
  return { classification: "Da verificare", confidence: 0,
    evidence: "Il testo contiene segnali di agenzia (" + result.evidence + "): annuncio di una ricerca filtrata per privati, mantenuto in coda per la verifica" };
}
function itemSeller(item: SubitoItem, classify: (text: string) => SellerResult): SellerResult {
  const fromText = classify([item.title, item.description].filter(Boolean).join(" "));
  if (fromText.classification === "Agenzia") return subitoNoAgencyExclusion(fromText);
  if (item.advertiserCompany === true) {
    return { classification: "Da verificare", confidence: 0, evidence: "Subito indica un inserzionista professionale: controllo manuale necessario" };
  }
  return fromText;
}

export function subitoItemRow(item: SubitoItem, ctx: SubitoRowContext, details: { pageSource: string | null; unprovenReason?: string | null }) {
  const gmailId = String(ctx.email.id);
  const receivedAt = emailIso(ctx.email.date);
  const text = [item.title, item.description].filter(Boolean).join(" ");
  const parsedTown = municipality(String(item.location || ""));
  const territory = territoryClassification(parsedTown);
  const classified = parsedTown ? itemSeller(item, ctx.classifySeller) : {
    classification: "Da verificare" as const, confidence: 0, evidence: "Comune non riconosciuto: verifica territoriale manuale necessaria"
  };
  // Novità non dimostrata: mai «Privato», così il salvataggio non archivia in automatico
  // un annuncio forse già visto. L'indicazione resta nell'evidenza e nella scheda.
  const seller = details.unprovenReason && classified.classification === "Privato"
    ? { classification: "Da verificare" as const, confidence: 0,
        evidence: "Il testo indica un privato (" + classified.evidence + "), ma la novità non è dimostrata: verifica manuale, nessuna archiviazione automatica" }
    : classified;
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
      territorio: territory,
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
        dettagli_completi: details.pageSource === "next_data",
        // Scheda proposta senza prova di novità: da verificare, nessuna notifica dedicata
        // (condizione del trigger, migrazione 20261126210000).
        ...(details.unprovenReason ? { novita_non_dimostrata: true, motivo_novita: details.unprovenReason } : {})
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
    preserve_existing: true,
    // Annuncio già presente in NMRE: nessun dato della scheda viene modificato (né campi
    // vuoti, né stato, né riapertura degli scartati); solo lo storico notifiche.
    history_only: true
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
        annunci_in_finestra_privati: result.decision?.windowPrivate ?? null,
        annunci_in_finestra_professionali: result.decision?.windowProfessional ?? null,
        annunci_ripubblicati: result.decision?.windowReposted ?? [],
        // Link a schede presenti nell'email: mai usati per decidere quali annunci sono nuovi.
        link_schede_nell_email_ignorati: ctx.digest.emailListingUrls.length,
        fonte_pagina: result.pageSource,
        url_ricerca: ctx.digest.searchUrl,
        link_non_riconosciuto: ctx.digest.unresolvedLink,
        chiave: ctx.digest.searchKey,
        tentativi: result.attempts,
        nuovo_tentativo: result.retry,
        ultimo_tentativo: ctx.nowIso,
        possibili: possible,
        recuperati: inserted,
        schede_proposte: (result.proposals ?? []).map(item => ({ id: item.id, url: item.url, titolo: item.title })),
        gia_in_archivio: result.archived.map(entry => ({ id: entry.id, url: entry.url, titolo: entry.title, annuncio_id: entry.annuncio_id, eliminato_dall_archivio: entry.eliminato }))
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

/** Schede singole per gli annunci con novità non dimostrata: attive solo con "true". */
export function subitoItemCandidatesEnabled(envValue: string | undefined): boolean {
  return String(envValue ?? "").trim().toLowerCase() === "true";
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
    async archivedListing(adId) {
      if (!/^\d{6,}$/.test(adId)) return null;
      // listing_key per gli immobili archiviati da NMRE, url per quelli inseriti a mano.
      const patterns = subitoIdLikePatterns(adId);
      for (const [column, pattern] of [...patterns.listingKey.map(p => ["listing_key", p]), ...patterns.url.map(p => ["url", p])]) {
        const { data, error } = await admin
          .from("annunci")
          .select("id,deleted_at,listing_key,url")
          .eq("owner_id", owner)
          .like(column, pattern)
          .limit(20);
        if (error) throw new Error("Confronto con l'Archivio non riuscito");
        // deno-lint-ignore no-explicit-any
        const match = (data || []).find((row: any) => rowReferencesSubitoAd(row, adId));
        if (match) return { annuncioId: String(match.id), eliminato: !!match.deleted_at };
      }
      return null;
    },
    async knownCandidate(adId) {
      if (!/^\d{6,}$/.test(adId)) return false;
      const byKey = await admin.from("annunci_candidati").select("id").eq("owner_id", owner).eq("dedup_key", "subito:" + adId).limit(1);
      if (byKey.error) throw new Error("Confronto con le opportunità non riuscito");
      if (byKey.data?.length) return true;
      // Tutte le opportunità, di qualunque stato (scartate comprese): listing_key e url, con e
      // senza titolo nell'URL. Sola lettura.
      const patterns = subitoIdLikePatterns(adId);
      for (const [column, pattern] of [...patterns.listingKey.map(p => ["listing_key", p]), ...patterns.url.map(p => ["url", p])]) {
        const found = await admin.from("annunci_candidati").select("id,dedup_key,listing_key,url").eq("owner_id", owner).like(column, pattern).limit(20);
        if (found.error) throw new Error("Confronto con le opportunità non riuscito");
        // deno-lint-ignore no-explicit-any
        if ((found.data || []).some((row: any) => rowReferencesSubitoAd(row, adId))) return true;
      }
      return false;
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
  ctx: { owner: string; classifySeller(text: string): SellerResult; now?: () => string; maxPages?: number; itemCandidates?: boolean; allowAutomatedPageFetch?: boolean }
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
        deferred,
        itemCandidates: ctx.itemCandidates === true,
        acquisitionEnabled: ctx.allowAutomatedPageFetch === true
      });
      const key = acquisition.status + ":" + acquisition.reason;
      result.outcomes[key] = (result.outcomes[key] || 0) + 1;
      const rowContext: SubitoRowContext = { owner: ctx.owner, email, digest, classifySeller: ctx.classifySeller, nowIso: now() };
      const inTerritory = (item: SubitoItem) => { const town = municipality(String(item.location || "")); return !town || isTargetMunicipality(town); };
      const inTerritoryItems = acquisition.items.filter(inTerritory);
      const inTerritoryProposals = (acquisition.proposals ?? []).filter(inTerritory);
      const outsideTerritory = acquisition.items.length + (acquisition.proposals ?? []).length - inTerritoryItems.length - inTerritoryProposals.length;
      if (outsideTerritory) result.outcomes["fuori_territorio"] = (result.outcomes["fuori_territorio"] || 0) + outsideTerritory;
      for (const item of inTerritoryItems) result.rows.push(subitoItemRow(item, rowContext, { pageSource: acquisition.pageSource }));
      for (const item of inTerritoryProposals) {
        result.rows.push(subitoItemRow(item, rowContext, { pageSource: acquisition.pageSource, unprovenReason: acquisition.reason }));
      }
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
