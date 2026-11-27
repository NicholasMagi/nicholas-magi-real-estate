// Prova senza scritture di una SINGOLA email Subito di ricerca salvata.
//
// Riusa senza modificarli i moduli di produzione di nmre-gmail-scheduled (lettura
// dell'email, riconoscimento della ricerca salvata, lettura della pagina dei risultati,
// decisione sui nuovi annunci, confronto con Opportunità e Archivio). Database, Gmail e
// pagina sono iniettati: qui arrivano solo oggetti di sola lettura (readonly.ts).
// Il risultato è un rapporto: nessuna riga viene salvata, nessuno stato cambia.
// deno-lint-ignore-file no-explicit-any
import { emailFromGmailMessage } from "../nmre-gmail-scheduled/_shared/mailbox.ts";
import { acquireSubitoDigest, subitoItemRow, supabaseSubitoDeps } from "../nmre-gmail-scheduled/_shared/subito_acquisition.ts";
import type { SubitoAcquisitionDeps } from "../nmre-gmail-scheduled/_shared/subito_acquisition.ts";
import {
  isSubitoSender, parseSubitoResultsPage, subitoSavedSearchDigest, SUBITO_CLOCK_TOLERANCE_MS, SUBITO_REASON_TEXT
} from "../nmre-gmail-scheduled/_shared/subito.ts";
import type { SubitoItem } from "../nmre-gmail-scheduled/_shared/subito.ts";
import { sellerClassificationDetails } from "../nmre-gmail-scheduled/_shared/parser.ts";
import type { ReadOnlyDb, ReadOnlyGmail } from "./readonly.ts";

export type DryRunRequest = { message_id?: string; subject: string; received_on: string; modalita?: "singola_email" | "intera_ricerca" };

const MAX_LISTED = 10;

function headerMap(message: any): { from: string; subject: string; date: string } {
  const headers: any[] = message?.payload?.headers || [];
  const get = (name: string) => String(headers.find(h => String(h?.name || "").toLowerCase() === name.toLowerCase())?.value || "");
  return { from: get("From"), subject: get("Subject"), date: get("Date") };
}
const normalizeSubject = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Giorno di ricezione nel fuso italiano (YYYY-MM-DD), o null. */
export function romeDay(dateHeader: string): string | null {
  const time = Date.parse(dateHeader);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
}

export function validateRequest(body: any): { ok: true; request: DryRunRequest } | { ok: false; reason: string } {
  const subject = normalizeSubject(body?.subject);
  const day = String(body?.received_on || "");
  const id = body?.message_id === undefined || body?.message_id === null || body?.message_id === "" ? undefined : String(body.message_id);
  if (!subject || subject.length > 300) return { ok: false, reason: "Indicare l'oggetto esatto dell'email (subject)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + "T00:00:00Z"))) {
    return { ok: false, reason: "Indicare il giorno di ricezione nel formato AAAA-MM-GG (received_on)." };
  }
  if (id !== undefined && !/^[0-9a-zA-Z]{8,32}$/.test(id)) return { ok: false, reason: "message_id non valido." };
  const mode = body?.modalita === undefined || body?.modalita === null || body?.modalita === "" ? "singola_email" : String(body.modalita);
  if (mode !== "singola_email" && mode !== "intera_ricerca") return { ok: false, reason: "modalita non valida: «singola_email» o «intera_ricerca»." };
  return { ok: true, request: { subject, received_on: day, message_id: id, modalita: mode } };
}

export type EmailCandidate = { id: string; subject: string; received: string; da_subito: boolean; corrisponde: boolean };

/**
 * Individua l'unica email da provare. Con message_id legge solo quel messaggio; senza,
 * elenca al massimo 10 email di subito.it attorno al giorno indicato. In entrambi i casi
 * mittente, oggetto esatto e giorno (ora italiana) devono coincidere, e deve esserci
 * ESATTAMENTE una corrispondenza: altrimenti nessuna email viene elaborata.
 */
export async function selectEmail(gmail: ReadOnlyGmail, request: DryRunRequest):
  Promise<{ ok: true; message: any; candidates: EmailCandidate[] } | { ok: false; reason: string; candidates: EmailCandidate[] }> {
  const describe = async (id: string): Promise<EmailCandidate> => {
    const h = headerMap(await gmail.metadata(id));
    const fromSubito = isSubitoSender(h.from);
    return {
      id, subject: normalizeSubject(h.subject).slice(0, 300), received: h.date.slice(0, 80), da_subito: fromSubito,
      corrisponde: fromSubito && normalizeSubject(h.subject) === request.subject && romeDay(h.date) === request.received_on
    };
  };
  let ids: string[];
  if (request.message_id) {
    ids = [request.message_id];
  } else {
    const day = Date.parse(request.received_on + "T00:00:00Z");
    // Oggetto tra virgolette (senza virgolette interne): restringe l'elenco all'email cercata.
    const subjectTerm = request.subject.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    const query = "from:subito.it subject:\"" + subjectTerm + "\" after:" + Math.floor((day - 86400000) / 1000)
      + " before:" + Math.floor((day + 2 * 86400000) / 1000);
    const list = await gmail.list(query, MAX_LISTED);
    ids = (Array.isArray(list?.messages) ? list.messages : []).map((m: any) => String(m?.id || "")).filter(Boolean).slice(0, MAX_LISTED);
  }
  const candidates: EmailCandidate[] = [];
  for (const id of ids) candidates.push(await describe(id));
  const matches = candidates.filter(c => c.corrisponde);
  if (matches.length === 0) {
    return { ok: false, reason: "Nessuna email di subito.it con questo oggetto e questo giorno: nessuna email elaborata.", candidates };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "Più email corrispondono: indicare message_id. Nessuna email elaborata.", candidates };
  }
  return { ok: true, message: await gmail.full(matches[0].id), candidates };
}

export type PageFetch = SubitoAcquisitionDeps["fetchPage"];

type ExistingCandidate = { id: string; stato: string | null; tipo_venditore: string | null; manuale: boolean };

/** Candidato già presente per questo ID Subito (stesse chiavi del salvataggio, più l'URL). */
async function existingCandidate(db: ReadOnlyDb, owner: string, adId: string): Promise<ExistingCandidate | null> {
  if (!/^\d{6,}$/.test(adId)) return null;
  const columns = "id,stato,tipo_venditore,seller_manual_override";
  const attempts: Array<(q: any) => any> = [
    q => q.eq("dedup_key", "subito:" + adId),
    q => q.like("listing_key", "subito.it/%-" + adId + ".htm"),
    q => q.like("url", "%subito.it/%-" + adId + ".htm%")
  ];
  for (const filter of attempts) {
    const { data, error } = await filter(db.from("annunci_candidati").select(columns).eq("owner_id", owner)).limit(1);
    if (error) throw new Error("Confronto con le Opportunità non riuscito");
    const row = Array.isArray(data) ? data[0] : null;
    if (row) return { id: String(row.id), stato: row.stato ?? null, tipo_venditore: row.tipo_venditore ?? null, manuale: row.seller_manual_override === true };
  }
  return null;
}

export type ItemCategory = "nuovo_certo" | "novita_non_dimostrabile" | "successivo_all_email" | "anteriore_alla_finestra";
export type ItemDecision =
  | "gia_nelle_opportunita" | "gia_in_archivio" | "creerebbe_candidato"
  | "proposta_scheda_da_verificare" | "nessuna_proposta" | "confronto_non_riuscito";

const DECISION_TEXT: Record<ItemDecision, string> = {
  gia_nelle_opportunita: "Già presente nelle Opportunità: nessuna azione, nessun dato riscritto",
  gia_in_archivio: "Già nell'Archivio: nessuna azione",
  creerebbe_candidato: "Nuovo con certezza: verrebbe creato un candidato «Da verificare»",
  proposta_scheda_da_verificare: "Novità non dimostrabile: proposta una scheda individuale «Da verificare»",
  nessuna_proposta: "Non collegato a questa email: nessuna proposta",
  confronto_non_riuscito: "Confronto con Opportunità/Archivio non riuscito: nessuna proposta"
};

const sellerLabel = (value: boolean | null) => value === true ? "Professionista (indicato da Subito)" : value === false ? "Privato (indicato da Subito)" : "Non indicato";

export type DryRunItem = {
  id: string; url: string; titolo: string | null; prezzo: number | null; comune: string | null; superficie_mq: number | null;
  locali: number | null; inserzionista: string; pubblicato_il: string | null; categoria: ItemCategory;
  gia_presente: { opportunita: ExistingCandidate | null; archivio: { id: string; eliminato: boolean } | null };
  decisione: ItemDecision; decisione_testo: string; oltre_limite_proposte: boolean;
  anteprima: null | { titolo: string; stato: string; tipo_venditore: string; dedup_key: string; listing_key: string | null; url: string; novita_non_dimostrata: boolean };
};

export type DryRunReport = {
  success: boolean; dry_run: true; esito: string; messaggio: string;
  email: null | { id: string; oggetto: string; ricevuta_il: string | null; mittente_subito: boolean; annunci_dichiarati: number | null;
    ricerca: string | null; url_ricerca: string | null; kxconfid_conservato: boolean; etichetta: string | null;
    gia_registrata_in_nmre: boolean | null };
  pagina: null | { stato: string; motivo: string; motivo_testo: string; url_finale: string | null; http: number | null; fonte: string | null;
    annunci_letti: number; letta_il: string; avviso: string };
  decisione: null | { certa: boolean; motivo: string; motivo_testo: string; nella_finestra: number | null; ripubblicati: string[] };
  annunci: DryRunItem[];
  riepilogo: Record<ItemDecision, number>;
  candidati_email?: EmailCandidate[];
};

const emptySummary = (): Record<ItemDecision, number> => ({
  gia_nelle_opportunita: 0, gia_in_archivio: 0, creerebbe_candidato: 0, proposta_scheda_da_verificare: 0, nessuna_proposta: 0, confronto_non_riuscito: 0
});

export function failureReport(esito: string, messaggio: string, candidates?: EmailCandidate[]): DryRunReport {
  return { success: false, dry_run: true, esito, messaggio, email: null, pagina: null, decisione: null, annunci: [], riepilogo: emptySummary(),
    ...(candidates ? { candidati_email: candidates } : {}) };
}

/** Analisi della singola email selezionata: nessuna scrittura, una sola lettura della pagina. */
export async function subitoDryRun(input: { message: any; db: ReadOnlyDb; owner: string; fetchPage: PageFetch; nowIso: string }): Promise<DryRunReport> {
  const email = emailFromGmailMessage(input.message);
  const digest = subitoSavedSearchDigest(email);
  if (!digest) return failureReport("non_ricerca_salvata", "L'email selezionata non è un'email Subito di ricerca salvata: nessuna elaborazione.");
  const receivedIso = Number.isFinite(Date.parse(String(email.date || ""))) ? new Date(String(email.date)).toISOString() : null;
  const emailInfo = {
    id: String(email.id), oggetto: normalizeSubject(email.subject).slice(0, 300), ricevuta_il: receivedIso,
    mittente_subito: isSubitoSender(email.from), annunci_dichiarati: digest.declaredCount, ricerca: digest.searchKey,
    url_ricerca: digest.searchUrl, kxconfid_conservato: !!digest.searchUrl && /[?&]kxconfid=/.test(digest.searchUrl),
    etichetta: digest.searchLabel || null,
    gia_registrata_in_nmre: null as boolean | null
  };

  // Una sola lettura della pagina: una seconda richiesta è un errore della prova.
  let pageReads = 0;
  let captured: { status: number; finalUrl: string; html: string } | null = null;
  const fetchOnce: PageFetch = async (url) => {
    if (++pageReads > 1) throw new Error("Prova senza scritture: è ammessa una sola lettura della pagina");
    captured = await input.fetchPage(url);
    return captured;
  };

  const deps = supabaseSubitoDeps(input.db, input.owner, fetchOnce);
  let acquisition;
  let previousIso: string | null = null;
  try {
    // Riga riepilogativa di questa stessa email già salvata da una sincronizzazione?
    emailInfo.gia_registrata_in_nmre = !!(await deps.existingDigest(String(email.id)));
    acquisition = await acquireSubitoDigest(email, digest, deps);
    // Inizio della finestra (email precedente della stessa ricerca), letto come fa la decisione.
    if (digest.searchKey && receivedIso) previousIso = await deps.previousDigestDate(digest.searchKey, receivedIso);
  } catch (error) {
    return { ...failureReport("confronto_non_riuscito", "Lettura del database non riuscita: nessun annuncio classificato (" +
      (error instanceof Error ? error.message.slice(0, 160) : "errore") + ")."), email: emailInfo };
  }
  const got = captured as { status: number; finalUrl: string; html: string } | null;
  const pageInfo = {
    stato: acquisition.status, motivo: acquisition.reason, motivo_testo: SUBITO_REASON_TEXT[acquisition.reason] || acquisition.reason,
    url_finale: got?.finalUrl ?? null, http: got?.status ?? null, fonte: acquisition.pageSource, annunci_letti: acquisition.pageCount,
    letta_il: input.nowIso,
    avviso: "La pagina è letta adesso, non al momento dell'email: annunci rimossi o scesi nelle pagine successive non compaiono."
  };
  if (acquisition.status === "errore" || !acquisition.decision || !got) {
    return { success: false, dry_run: true, esito: "pagina_non_disponibile", messaggio: pageInfo.motivo_testo, email: emailInfo, pagina: pageInfo,
      decisione: null, annunci: [], riepilogo: emptySummary() };
  }

  const decision = acquisition.decision;
  const page = parseSubitoResultsPage(got.html.slice(0, 3_000_000));
  const certainIds = new Set(decision.newItems.map(item => item.id));
  const possibleIds = new Set(decision.possibleItems.map(item => item.id));
  const emailTime = receivedIso ? Date.parse(receivedIso) : NaN;
  const limit = Number.isFinite(emailTime) ? emailTime + SUBITO_CLOCK_TOLERANCE_MS : null;
  const previousTime = previousIso ? Date.parse(previousIso) : NaN;
  const category = (item: SubitoItem): { category: ItemCategory; overflow: boolean } => {
    if (certainIds.has(item.id)) return { category: "nuovo_certo", overflow: false };
    if (possibleIds.has(item.id)) return { category: "novita_non_dimostrabile", overflow: false };
    const time = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    if (Number.isFinite(time) && limit !== null && time > limit) return { category: "successivo_all_email", overflow: false };
    // Anteriore all'email precedente della stessa ricerca: già segnalato da quella email.
    if (Number.isFinite(time) && Number.isFinite(previousTime) && time <= previousTime) return { category: "anteriore_alla_finestra", overflow: false };
    if (decision.certain) return { category: "anteriore_alla_finestra", overflow: false };
    // Plausibile ma escluso solo dal limite di proposte della decisione: resta proposto.
    return { category: "novita_non_dimostrabile", overflow: true };
  };

  const rowContext = { owner: input.owner, email, digest, classifySeller: sellerClassificationDetails, nowIso: input.nowIso };
  const items: DryRunItem[] = [];
  const summary = emptySummary();
  let lookupFailed = false;
  for (const item of page.items) {
    const { category: itemCategory, overflow } = category(item);
    let opportunita: ExistingCandidate | null = null;
    let archivio: { id: string; eliminato: boolean } | null = null;
    let decisione: ItemDecision;
    try {
      opportunita = await existingCandidate(input.db, input.owner, item.id);
      // Entrambi i confronti, sempre: il rapporto mostra ogni presenza già nota.
      const archived = await deps.archivedListing(item.id);
      archivio = archived ? { id: archived.annuncioId, eliminato: archived.eliminato } : null;
      decisione = opportunita ? "gia_nelle_opportunita"
        : archivio ? "gia_in_archivio"
        : itemCategory === "nuovo_certo" ? "creerebbe_candidato"
        : itemCategory === "novita_non_dimostrabile" ? "proposta_scheda_da_verificare"
        : "nessuna_proposta";
    } catch {
      lookupFailed = true;
      decisione = "confronto_non_riuscito";
    }
    let anteprima: DryRunItem["anteprima"] = null;
    if (decisione === "creerebbe_candidato" || decisione === "proposta_scheda_da_verificare") {
      const row = subitoItemRow(item, rowContext, { pageSource: acquisition.pageSource });
      anteprima = {
        titolo: row.titolo, stato: row.stato, tipo_venditore: row.tipo_venditore, dedup_key: row.dedup_key,
        listing_key: row.listing_key, url: row.url, novita_non_dimostrata: decisione === "proposta_scheda_da_verificare"
      };
    }
    summary[decisione]++;
    items.push({
      id: item.id, url: item.url, titolo: item.title, prezzo: item.price, comune: item.location, superficie_mq: item.surfaceMq,
      locali: item.rooms, inserzionista: sellerLabel(item.advertiserCompany), pubblicato_il: item.publishedAt, categoria: itemCategory,
      gia_presente: { opportunita, archivio }, decisione, decisione_testo: DECISION_TEXT[decisione], oltre_limite_proposte: overflow, anteprima
    });
  }
  // Fail-safe: se un confronto non è riuscito, nessuna proposta resta valida.
  if (lookupFailed) {
    for (const entry of items) {
      if (entry.decisione === "creerebbe_candidato" || entry.decisione === "proposta_scheda_da_verificare") {
        summary[entry.decisione]--;
        summary.confronto_non_riuscito++;
        entry.decisione = "confronto_non_riuscito";
        entry.decisione_testo = DECISION_TEXT.confronto_non_riuscito;
        entry.anteprima = null;
      }
    }
  }
  return {
    success: !lookupFailed, dry_run: true,
    esito: lookupFailed ? "confronto_non_riuscito" : decision.certain ? "novita_dimostrata" : "novita_non_dimostrabile",
    messaggio: lookupFailed ? "Almeno un confronto con Opportunità/Archivio non è riuscito: nessuna proposta." : SUBITO_REASON_TEXT[decision.reason] || decision.reason,
    email: emailInfo, pagina: pageInfo,
    decisione: { certa: decision.certain, motivo: decision.reason, motivo_testo: SUBITO_REASON_TEXT[decision.reason] || decision.reason,
      nella_finestra: decision.windowCount, ripubblicati: decision.windowReposted },
    annunci: items, riepilogo: summary
  };
}

const euro = (value: number | null) => value === null ? "prezzo n/d" : "€ " + value.toLocaleString("it-IT");

/** Rapporto leggibile (testo semplice). Non contiene il corpo dell'email né token. */
export function reportText(report: DryRunReport): string {
  const lines: string[] = ["PROVA SENZA SCRITTURE · Email Subito di ricerca salvata", "Esito: " + report.esito + " — " + report.messaggio];
  if (report.candidati_email?.length) {
    lines.push("", "Email esaminate (solo intestazioni):");
    for (const c of report.candidati_email) lines.push("  - " + c.id + " · " + c.received + " · " + c.subject + (c.corrisponde ? " · CORRISPONDE" : ""));
  }
  if (report.email) {
    const e = report.email;
    lines.push("", "Email: " + e.id + " · " + (e.ricevuta_il || "data n/d") + " · " + e.oggetto,
      "  Annunci dichiarati: " + (e.annunci_dichiarati ?? "n/d") + " · kxconfid conservato: " + (e.kxconfid_conservato ? "sì" : "no"),
      "  Ricerca: " + (e.etichetta || e.ricerca || "n/d"),
      "  Email già registrata in NMRE: " + (e.gia_registrata_in_nmre === null ? "n/d" : e.gia_registrata_in_nmre ? "sì" : "no"));
  }
  if (report.pagina) {
    const p = report.pagina;
    lines.push("", "Pagina: " + p.stato + " (" + p.motivo_testo + ") · HTTP " + (p.http ?? "n/d") + " · fonte " + (p.fonte || "n/d") + " · annunci letti " + p.annunci_letti,
      "  " + p.avviso);
  }
  if (report.decisione) {
    lines.push("", "Novità: " + (report.decisione.certa ? "dimostrata" : "NON dimostrabile") + " — " + report.decisione.motivo_testo);
  }
  if (report.annunci.length) {
    lines.push("", "Annunci:");
    for (const a of report.annunci) {
      lines.push("  [" + a.id + "] " + (a.titolo || "(senza titolo)") + " · " + euro(a.prezzo) + " · " + (a.comune || "comune n/d")
        + " · " + (a.superficie_mq ? a.superficie_mq + " m²" : "m² n/d") + " · " + a.inserzionista,
        "    " + a.url,
        "    Pubblicato: " + (a.pubblicato_il || "n/d") + " · Categoria: " + a.categoria + (a.oltre_limite_proposte ? " (oltre il limite di proposte)" : ""),
        "    → " + a.decisione_testo
          + (a.gia_presente.opportunita ? " (candidato " + a.gia_presente.opportunita.id + ", stato " + (a.gia_presente.opportunita.stato || "n/d") + ")" : "")
          + (a.gia_presente.archivio ? " (Archivio " + a.gia_presente.archivio.id + (a.gia_presente.archivio.eliminato ? ", eliminato" : "") + ")" : ""));
    }
  }
  const s = report.riepilogo;
  lines.push("", "Riepilogo: proposte «Da verificare» " + s.proposta_scheda_da_verificare + " · nuovi certi " + s.creerebbe_candidato
    + " · già nelle Opportunità " + s.gia_nelle_opportunita + " · già in Archivio " + s.gia_in_archivio
    + " · nessuna proposta " + s.nessuna_proposta + " · confronti non riusciti " + s.confronto_non_riuscito,
    "Nessuna scrittura eseguita: nessun candidato creato o modificato, cursore Gmail non letto né modificato, nessuna notifica.");
  return lines.join("\n");
}
