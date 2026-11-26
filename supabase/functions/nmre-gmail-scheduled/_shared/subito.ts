// Email Subito di ricerca salvata ("<ricerca> ha 3 nuovi annunci per te"): l'email non
// contiene gli immobili ma un pulsante verso la pagina dei risultati. Qui ci sono solo
// funzioni pure (nessuna rete, nessun database): riconoscimento dell'email, link del
// pulsante, lettura della pagina dei risultati e individuazione degli annunci nuovi.

export type SubitoDigest = {
  /** Numero di nuovi risultati dichiarato dall'email (oggetto o testo). */
  declaredCount: number | null;
  /** Nome della ricerca salvata, dall'oggetto ("Appartamenti a Ancona e provincia"). */
  searchLabel: string | null;
  /** URL della pagina dei risultati, senza parametri di tracciamento. */
  searchUrl: string | null;
  /** Chiave stabile della ricerca (stessa ricerca salvata → stessa chiave). */
  searchKey: string | null;
  /** Da dove viene il link: pulsante "Vedi i nuovi annunci" o altro link di ricerca. */
  linkSource: "pulsante" | "altro_link" | null;
  /** Link del pulsante non riconoscibile come pagina di ricerca (per esempio un redirect). */
  unresolvedLink: string | null;
  /** Schede specifiche già presenti nell'email (alcune email le includono). */
  emailListingUrls: string[];
};

export type SubitoItem = {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  price: number | null;
  location: string | null;
  surfaceMq: number | null;
  rooms: number | null;
  images: string[];
  /** Data di pubblicazione (o ultimo aggiornamento) indicata da Subito, in UTC. */
  publishedAt: string | null;
  /** true se Subito indica un inserzionista professionale, false se privato, null se ignoto. */
  advertiserCompany: boolean | null;
};

export type SubitoPage = {
  status: "ok" | "bloccata" | "vuota";
  /** Fonte dei dati: dati strutturati della pagina, JSON-LD o soli link. */
  source: "next_data" | "json_ld" | "link" | "nessuna";
  items: SubitoItem[];
};

const TRACKING_PARAMS = /^(?:utm_[a-z_]+|xtor|from|fbclid|gclid|mc_[a-z]+)$/i;
// kxconfid viene mantenuto nell’URL usato per la richiesta a Subito, ma non identifica
// una ricerca distinta: può cambiare tra email della stessa ricerca salvata.
const SEARCH_KEY_IGNORED_PARAMS = /^(?:utm_[a-z_]+|kxconfid|xtor|from|fbclid|gclid|mc_[a-z]+|order|o|page)$/i;
const REDIRECT_PARAMS = ["url", "u", "q", "target", "dest", "destination", "redirect", "redirect_url", "to", "link"];

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#x2f;|&#47;/gi, "/").replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}
function plainText(html: string): string {
  return decodeEntities(String(html || "").replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}
function host(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}
function isSubitoHost(url: URL): boolean {
  const h = host(url);
  return h === "subito.it" || h.endsWith(".subito.it");
}

/** Indirizzo del mittente su subito.it (per esempio "Subito <noreply@subito.it>"). */
export function isSubitoSender(from: unknown): boolean {
  const value = String(from || "");
  const address = (value.match(/<([^>]+)>/)?.[1] || value).trim().toLowerCase();
  return /@(?:[a-z0-9-]+\.)*subito\.it$/.test(address);
}

/** Scheda di un singolo annuncio Subito: /<categoria>/<titolo>-<id>.htm */
export function subitoAdId(value: unknown): string | null {
  try {
    const url = new URL(String(value || ""));
    if (!isSubitoHost(url)) return null;
    const match = url.pathname.match(/^\/[a-z0-9-]+\/[a-z0-9-]*?-?(\d{6,})\.htm$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
/** URL diretto della scheda, senza parametri di tracciamento. */
export function subitoListingUrl(value: unknown): string | null {
  if (!subitoAdId(value)) return null;
  const url = new URL(String(value));
  return "https://www.subito.it" + url.pathname;
}
/** ID Subito ricavato da una listing_key NMRE (subito.it/<categoria>/<titolo>-<id>.htm). */
export function subitoAdIdFromListingKey(value: unknown): string | null {
  const key = String(value || "");
  if (!key.startsWith("subito.it/")) return null;
  return subitoAdId("https://www." + key);
}

/** Pagina di risultati Subito (/annunci-<regione>/...), senza tracciamento; null se non lo è. */
export function normalizeSubitoSearchUrl(value: unknown, depth = 0): string | null {
  let url: URL;
  try {
    url = new URL(decodeEntities(String(value || "").trim()));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (isSubitoHost(url) && host(url) === "subito.it" && /^\/annunci-[a-z-]+\//i.test(url.pathname)) {
    const clean = new URL("https://www.subito.it" + url.pathname);
    for (const [key, val] of url.searchParams) if (!TRACKING_PARAMS.test(key)) clean.searchParams.append(key, val);
    return clean.toString();
  }
  if (depth < 2) {
    for (const key of REDIRECT_PARAMS) {
      const nested = url.searchParams.get(key);
      if (nested && /^https?:\/\//i.test(nested)) {
        const resolved = normalizeSubitoSearchUrl(nested, depth + 1);
        if (resolved) return resolved;
      }
    }
  }
  return null;
}
/** Stessa ricerca salvata → stessa chiave (senza tracciamento, ordinamento e pagina). */
export function subitoSearchKey(searchUrl: string | null): string | null {
  if (!searchUrl) return null;
  try {
    const url = new URL(searchUrl);
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !SEARCH_KEY_IGNORED_PARAMS.test(key))
      .sort(([a, av], [b, bv]) => a === b ? av.localeCompare(bv) : a.localeCompare(b));
    const path = url.pathname.toLowerCase().replace(/\/+$/, "");
    return "subito.it" + path + (params.length ? "?" + params.map(([k, v]) => k + "=" + v).join("&") : "");
  } catch {
    return null;
  }
}

type Anchor = { href: string; text: string };
function anchors(html: string): Anchor[] {
  const output: Anchor[] = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(html || ""))) && output.length < 500) {
    const href = match[1].match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
    if (href) output.push({ href: decodeEntities(href.trim()), text: plainText(match[2]) });
  }
  return output;
}

/** Link del pulsante "Vedi i nuovi annunci" (o, in mancanza, di un altro link alla ricerca). */
export function extractSavedSearchLink(html: string, text = ""): { url: string | null; source: "pulsante" | "altro_link" | null; unresolved: string | null } {
  const list = anchors(html);
  const button = list.find(anchor => /\bvedi\s+(?:i\s+)?(?:nuovi\s+)?(?:annunci|risultati)\b/i.test(anchor.text));
  if (button) {
    const url = normalizeSubitoSearchUrl(button.href);
    if (url) return { url, source: "pulsante", unresolved: null };
  }
  for (const anchor of list) {
    const url = normalizeSubitoSearchUrl(anchor.href);
    if (url) return { url, source: "altro_link", unresolved: null };
  }
  for (const raw of String(text || "").match(/https?:\/\/[^\s<>"']+/gi) || []) {
    const url = normalizeSubitoSearchUrl(raw.replace(/[),.;\]]+$/, ""));
    if (url) return { url, source: "altro_link", unresolved: null };
  }
  return { url: null, source: null, unresolved: button ? button.href.slice(0, 2000) : null };
}

/**
 * Email Subito di ricerca salvata con uno o più nuovi risultati; null per le altre email
 * (che seguono il percorso normale, per esempio l'avviso di un singolo annuncio).
 */
export function subitoSavedSearchDigest(email: { from?: unknown; subject?: unknown; snippet?: unknown; bodyText?: unknown; bodyHtml?: unknown }): SubitoDigest | null {
  if (!isSubitoSender(email.from)) return null;
  const subject = String(email.subject || "").replace(/\s+/g, " ").trim();
  const html = String(email.bodyHtml || "");
  const text = [subject, String(email.snippet || ""), html ? plainText(html) : String(email.bodyText || "")].join(" ").replace(/\s+/g, " ");
  const subjectMatch = subject.match(/^(.{2,160}?)\s+ha\s+(\d{1,3}|un)\s+nuov[oi]\s+annunc[io]\b/i);
  const bodyMatch = text.match(/\bci\s+sono\s+(\d{1,3})\s+nuovi\s+risultati\s+per\s+la\s+ricerca\s+che\s+hai\s+salvato/i)
    || text.match(/\bc['’]è\s+(un)\s+nuovo\s+risultato\s+per\s+la\s+ricerca\s+che\s+hai\s+salvato/i);
  if (!subjectMatch && !bodyMatch) return null;
  const count = (value: string | undefined) => value === undefined ? null : /^un$/i.test(value) ? 1 : Number(value);
  const declaredCount = count(bodyMatch?.[1]) ?? count(subjectMatch?.[2]);
  const link = extractSavedSearchLink(html, String(email.bodyText || ""));
  const emailListingUrls = [...new Set(anchors(html).map(anchor => subitoListingUrl(anchor.href)).filter((url): url is string => !!url))];
  return {
    declaredCount: declaredCount !== null && Number.isFinite(declaredCount) && declaredCount > 0 ? declaredCount : null,
    searchLabel: subjectMatch?.[1]?.trim().slice(0, 160) || null,
    searchUrl: link.url,
    searchKey: subitoSearchKey(link.url),
    linkSource: link.source,
    unresolvedLink: link.unresolved,
    emailListingUrls
  };
}

// ---------- Pagina dei risultati ----------

/** Data di Subito ("2026-11-26 09:10:22", ora italiana) o ISO con fuso → ISO UTC. */
export function parseSubitoDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const time = Date.parse(raw);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(part => Number(part || 0));
  // Ora locale di Roma → UTC: si stima l'offset e lo si verifica con Intl.
  let utc = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utc)).reduce((acc, part) => ({ ...acc, [part.type]: Number(part.value) }), {} as Record<string, number>);
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    utc -= shown - Date.UTC(y, mo - 1, d, h, mi, s);
  }
  return new Date(utc).toISOString();
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/\s/g, "");
  if (!text) return null;
  const digits = text.replace(/[€]|mq|m²/gi, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(digits.match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
// deno-lint-ignore no-explicit-any
function featureValue(item: any, names: string[]): number | null {
  const features = item?.features;
  // deno-lint-ignore no-explicit-any
  let entry: any = null;
  if (Array.isArray(features)) entry = features.find(f => names.includes(String(f?.uri ?? f?.key ?? "")));
  else if (features && typeof features === "object") entry = names.map(name => features[name]).find(Boolean);
  const first = Array.isArray(entry?.values) ? entry.values[0] : entry?.value ?? null;
  if (first === null || first === undefined) return null;
  return numberFrom(typeof first === "object" ? (first.key ?? first.value) : first);
}
// deno-lint-ignore no-explicit-any
function imageUrls(item: any): string[] {
  const list = Array.isArray(item?.images) ? item.images : [];
  const output: string[] = [];
  for (const image of list) {
    const candidate = typeof image === "string" ? image
      : image?.cdnBaseUrl || image?.url || image?.uri || (Array.isArray(image?.scale) ? image.scale[0]?.uri || image.scale[0]?.secureuri : null);
    if (typeof candidate === "string" && /^https:\/\//i.test(candidate)) output.push(candidate.slice(0, 500));
    if (output.length >= 10) break;
  }
  return output;
}
function text(value: unknown, max: number): string | null {
  const clean = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return clean ? clean.slice(0, max) : null;
}
// deno-lint-ignore no-explicit-any
function itemFromObject(item: any): SubitoItem | null {
  const url = subitoListingUrl(item?.urls?.default ?? item?.url);
  const id = subitoAdId(url);
  if (!url || !id) return null;
  const geo = item?.geo || {};
  const company = item?.advertiser?.company;
  return {
    id, url,
    title: text(item?.subject ?? item?.title ?? item?.name, 250),
    description: text(item?.body ?? item?.description, 2000),
    price: featureValue(item, ["/price"]) ?? numberFrom(item?.price ?? item?.offers?.price),
    location: text(geo?.town?.value ?? geo?.city?.value ?? item?.location, 120),
    surfaceMq: featureValue(item, ["/size"]),
    rooms: featureValue(item, ["/room", "/rooms"]),
    images: imageUrls(item),
    publishedAt: parseSubitoDate(item?.date ?? item?.datePosted),
    advertiserCompany: company === true ? true : company === false ? false : null
  };
}
// Ricerca degli annunci in un oggetto JSON qualsiasi: tollera spostamenti nella struttura.
// deno-lint-ignore no-explicit-any
function collectItems(root: unknown, accept: (node: any) => boolean): SubitoItem[] {
  const found: SubitoItem[] = [];
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }];
  let visited = 0;
  while (stack.length && visited++ < 200000) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== "object" || depth > 60) continue;
    if (!Array.isArray(node) && accept(node)) {
      const item = itemFromObject(node);
      if (item) { found.push(item); continue; }
    }
    const values = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
    for (let index = values.length - 1; index >= 0; index--) stack.push({ node: values[index], depth: depth + 1 });
  }
  const unique = new Map<string, SubitoItem>();
  for (const item of found) if (!unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()];
}

const BLOCK_MARKERS = /captcha-delivery\.com|datadome|g-recaptcha|h-captcha|hcaptcha|cf-chl-|challenge-platform|attention required|access denied|accesso negato|verifica di non essere un robot/i;

/** Annunci della pagina dei risultati, nell'ordine della pagina. */
export function parseSubitoResultsPage(html: string): SubitoPage {
  const source = String(html || "");
  const nextData = source.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (nextData) {
    try {
      // deno-lint-ignore no-explicit-any
      const items = collectItems(JSON.parse(nextData), (node: any) => typeof node?.urls?.default === "string");
      if (items.length) return { status: "ok", source: "next_data", items };
    } catch { /* struttura diversa: si prova con le altre fonti */ }
  }
  const ldItems: SubitoItem[] = [];
  for (const block of source.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      // deno-lint-ignore no-explicit-any
      ldItems.push(...collectItems(JSON.parse(block[1]), (node: any) => typeof node?.url === "string" && !!subitoAdId(node.url)));
    } catch { /* blocco non valido */ }
  }
  if (ldItems.length) {
    const unique = new Map(ldItems.map(item => [item.id, item]));
    return { status: "ok", source: "json_ld", items: [...unique.values()] };
  }
  const linked = new Map<string, SubitoItem>();
  for (const anchor of anchors(source)) {
    const url = subitoListingUrl(anchor.href.startsWith("/") ? "https://www.subito.it" + anchor.href : anchor.href);
    const id = subitoAdId(url);
    if (url && id && !linked.has(id)) {
      linked.set(id, { id, url, title: text(anchor.text, 250), description: null, price: null, location: null, surfaceMq: null, rooms: null, images: [], publishedAt: null, advertiserCompany: null });
    }
  }
  if (linked.size) return { status: "ok", source: "link", items: [...linked.values()] };
  if (BLOCK_MARKERS.test(source)) return { status: "bloccata", source: "nessuna", items: [] };
  return { status: "vuota", source: "nessuna", items: [] };
}

/** Protezioni del sito (CAPTCHA, verifica anti-robot): non vengono aggirate. */
export function isBlockedSubitoPage(status: number, html: string): boolean {
  return status === 401 || status === 403 || status === 429 || (BLOCK_MARKERS.test(String(html || "")) && !/__NEXT_DATA__/.test(String(html || "")));
}

// ---------- Annunci nuovi ----------

export type NewListingsDecision = {
  certain: boolean;
  /** Motivo della decisione (per il titolare e per i test). */
  reason:
    | "annunci_nell_email" | "finestra_temporale"
    | "numero_non_dichiarato" | "nessun_annuncio_nella_pagina" | "date_non_disponibili" | "dati_parziali"
    | "data_email_mancante" | "nessuna_notifica_precedente" | "pagina_incompleta" | "conteggio_diverso";
  /** Annunci nuovi individuati con certezza (vuoto se certain è false). */
  newItems: SubitoItem[];
  /** Annunci plausibili da far verificare al titolare (se certain è false). */
  possibleItems: SubitoItem[];
  /** Annunci trovati nella finestra temporale (per il messaggio di verifica). */
  windowCount: number | null;
};

export const SUBITO_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
export const SUBITO_MAX_POSSIBLE_ITEMS = 15;

/**
 * Nuovi annunci di un'email di ricerca salvata. Certezza solo se:
 *  - l'email elenca essa stessa le schede, nello stesso numero dichiarato; oppure
 *  - la pagina ha le date di tutti gli annunci, è nota l'email precedente della stessa
 *    ricerca (inizio della finestra), la pagina mostra almeno un annuncio anteriore a
 *    quella email (la finestra è completa) e nella finestra ci sono esattamente gli
 *    annunci dichiarati.
 * Negli altri casi nessuna corrispondenza viene inventata: certain=false e gli annunci
 * plausibili vengono proposti per la verifica.
 */
export function identifyNewSubitoListings(params: {
  declaredCount: number | null;
  page: SubitoPage | null;
  emailListingUrls: string[];
  emailDateIso: string | null;
  previousDigestIso: string | null;
}): NewListingsDecision {
  const pageItems = params.page?.items || [];
  const byId = new Map(pageItems.map(item => [item.id, item]));
  const emailIds = [...new Set(params.emailListingUrls.map(subitoAdId).filter((id): id is string => !!id))];
  const emailTime = params.emailDateIso ? Date.parse(params.emailDateIso) : NaN;
  const limit = Number.isFinite(emailTime) ? emailTime + SUBITO_CLOCK_TOLERANCE_MS : null;
  const previous = params.previousDigestIso ? Date.parse(params.previousDigestIso) : NaN;
  const possible = () => pageItems
    .filter(item => {
      const time = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
      if (!Number.isFinite(time)) return true;
      if (limit !== null && time > limit) return false;
      return !(Number.isFinite(previous) && time <= previous);
    })
    .slice(0, SUBITO_MAX_POSSIBLE_ITEMS);
  const uncertain = (reason: NewListingsDecision["reason"], windowCount: number | null = null): NewListingsDecision =>
    ({ certain: false, reason, newItems: [], possibleItems: possible(), windowCount });

  if (emailIds.length && params.declaredCount !== null && emailIds.length === params.declaredCount) {
    const newItems = emailIds.map(id => byId.get(id) || {
      id, url: "https://www.subito.it" + new URL(params.emailListingUrls.find(url => subitoAdId(url) === id)!).pathname,
      title: null, description: null, price: null, location: null, surfaceMq: null, rooms: null, images: [], publishedAt: null, advertiserCompany: null
    });
    return { certain: true, reason: "annunci_nell_email", newItems, possibleItems: [], windowCount: newItems.length };
  }
  if (params.declaredCount === null) return uncertain("numero_non_dichiarato");
  if (!pageItems.length) return uncertain("nessun_annuncio_nella_pagina");
  if (params.page?.source !== "next_data") return uncertain("date_non_disponibili");
  if (pageItems.some(item => !item.publishedAt)) return uncertain("dati_parziali");
  if (limit === null) return uncertain("data_email_mancante");
  if (!Number.isFinite(previous)) return uncertain("nessuna_notifica_precedente");
  const inWindow = pageItems.filter(item => {
    const time = Date.parse(item.publishedAt!);
    return time > previous && time <= limit;
  });
  const boundaryVisible = pageItems.some(item => Date.parse(item.publishedAt!) <= previous);
  if (!boundaryVisible) return uncertain("pagina_incompleta", inWindow.length);
  if (inWindow.length !== params.declaredCount) return uncertain("conteggio_diverso", inWindow.length);
  return { certain: true, reason: "finestra_temporale", newItems: inWindow, possibleItems: [], windowCount: inWindow.length };
}

/** Testo per il titolare, per ogni motivo di incertezza o errore. */
export const SUBITO_REASON_TEXT: Record<string, string> = {
  annunci_nell_email: "Annunci indicati direttamente nell'email",
  finestra_temporale: "Annunci pubblicati tra l'email precedente della stessa ricerca e questa",
  numero_non_dichiarato: "L'email non indica quanti sono i nuovi annunci",
  nessun_annuncio_nella_pagina: "La pagina dei risultati non contiene annunci riconoscibili",
  date_non_disponibili: "La pagina non indica le date di pubblicazione: impossibile capire quali sono i nuovi",
  dati_parziali: "Alcuni annunci della pagina non hanno la data: recupero parziale",
  data_email_mancante: "Data di ricezione dell'email non disponibile",
  nessuna_notifica_precedente: "Prima email di questa ricerca acquisita da NMRE: non si sa da quando contare i nuovi annunci",
  pagina_incompleta: "La pagina non mostra annunci anteriori all'email precedente: potrebbero esserci altri risultati",
  conteggio_diverso: "Il numero di annunci trovati non corrisponde a quello dichiarato dall'email",
  link_mancante: "Link alla pagina dei risultati non trovato nell'email",
  pagina_bloccata: "Pagina dei risultati protetta (verifica anti-robot): non aggirata",
  pagina_vuota: "Pagina dei risultati vuota o con una struttura non riconosciuta",
  errore_rete: "Pagina dei risultati non raggiungibile (errore di rete o tempo scaduto)",
  errore_http: "La pagina dei risultati ha risposto con un errore",
  rinviato: "Recupero rinviato al ciclo successivo (troppe pagine da leggere in questo ciclo)"
};
