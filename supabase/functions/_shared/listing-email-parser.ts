/**
 * Parser conservativo per notifiche immobiliari Gmail.
 *
 * Non salva annunci e non decide mai automaticamente che un venditore sia privato.
 * Produce soltanto candidati da mostrare a una persona per la revisione.
 */

export type GmailApiMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailMimePart;
};

export type GmailMimePart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMimePart[];
};

export type ListingCandidate = {
  messageId: string;
  deduplicationKey: string;
  titolo: string;
  comune: string | null;
  prezzo: number | null;
  contatto: string | null;
  notificationSender: string | null;
  tipo_venditore: "Da verificare";
  portale: string | null;
  url: string | null;
  allUrls: string[];
  receivedAt: string | null;
  reviewStatus: "da_verificare";
  likelyRealEstate: boolean;
  warnings: string[];
};

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&euro;/gi, "€")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([\da-f]+);/gi, (_match, code) =>
      String.fromCodePoint(parseInt(code, 16))
    );
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      // Nelle notifiche dei portali il link all'immobile spesso è solo nell'href.
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => label + " " + href)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[\t\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectMimeParts(part: GmailMimePart | undefined, out: {
  plain: string[];
  html: string[];
}): void {
  if (!part) return;

  const data = part.body?.data;
  if (data) {
    try {
      const decoded = decodeBase64Url(data);
      if (part.mimeType === "text/plain") out.plain.push(decoded);
      if (part.mimeType === "text/html") out.html.push(decoded);
    } catch {
      // Una parte MIME malformata non deve bloccare l'intera importazione.
    }
  }

  for (const child of part.parts ?? []) collectMimeParts(child, out);
}

function extractPrimaryDetailLinks(html: string): string[] {
  const links: string[] = [];
  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchors.exec(html)) !== null) {
    const label = htmlToText(match[2]).replace(/\s+/g, " ").trim();
    if (/vedi dettagli|scopri i dettagli|visualizza annuncio|apri annuncio/i.test(label)) {
      links.push(decodeHtmlEntities(match[1]));
    }
  }
  return links;
}

export function extractGmailMessageText(message: GmailApiMessage): string {
  const parts = { plain: [] as string[], html: [] as string[] };
  collectMimeParts(message.payload, parts);

  const htmlText = parts.html.map(htmlToText).filter(Boolean);
  const mainText = parts.plain.length
    ? parts.plain.join("\n\n").trim()
    : htmlText.join("\n\n");

  // Il link dell'annuncio può esistere solo nell'href del pulsante HTML.
  // Lo mettiamo prima degli altri URL promozionali o di gestione ricerca.
  const detailLinks = parts.html.flatMap(extractPrimaryDetailLinks);
  return [...detailLinks, mainText].filter(Boolean).join("\n\n");
}

function getHeader(message: GmailApiMessage, name: string): string {
  const header = message.payload?.headers?.find(
    (item) => item.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value?.trim() ?? "";
}

function extractEmailAddress(from: string): string | null {
  const match = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]}]+/gi) ?? [];
  const unique = new Set<string>();

  for (const raw of found) {
    const cleaned = raw.replace(/[.,;!?]+$/g, "");
    try {
      const url = new URL(cleaned);
      if (url.protocol === "https:" || url.protocol === "http:") {
        unique.add(url.toString());
      }
    } catch {
      // Ignora link non validi.
    }
  }
  return [...unique];
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gclid|fbclid|mc_cid|mc_eid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function parseItalianPrice(raw: string): number | null {
  const value = raw.trim().replace(/\s+/g, "");
  if (!value) return null;

  let normalized = value;
  if (value.includes(",") && value.includes(".")) {
    // Formato italiano con migliaia e decimali: 145.000,00
    normalized = value.replace(/\./g, "").replace(",", ".");
  } else if (value.includes(",")) {
    // La virgola è decimale solo se seguita da una o due cifre.
    normalized = /,\d{1,2}$/.test(value)
      ? value.replace(",", ".")
      : value.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    // In assenza di virgola, i punti in gruppi di tre sono migliaia.
    normalized = value.replace(/\./g, "");
  }

  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0 || number > 100000000) {
    return null;
  }
  return Math.round(number * 100) / 100;
}

function extractPrice(text: string): number | null {
  const patterns = [
    /(?:prezzo|richiesta|prezzo richiesto)\s*[:\-]?\s*(?:€\s*)?([\d][\d. ,]{3,})\s*€?/i,
    /€\s*([\d][\d. ,]{3,})/i,
    /([\d][\d. ,]{3,})\s*€/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const price = parseItalianPrice(match[1]);
    if (price !== null) return price;
  }
  return null;
}

function extractMunicipality(text: string): string | null {
  const labeled = text.match(
    /(?:comune|località|localita|ubicazione)\s*[:\-]\s*([^\n,;|]{2,70})/i
  );
  const labeledValue = labeled?.[1]?.trim().replace(/[.]+$/, "");
  if (labeledValue) return labeledValue;

  // Es.: "via A. Bravi, 23, Recanati".
  const address = text.match(
    /(?:^|\n)[^\n]*(?:via|viale|piazza|corso|vicolo|strada|contrada)\s+[^,\n]+,\s*\d+[a-z]?\s*,\s*([\p{L}'’ -]{2,50})\s*(?=\n|$)/imu
  );
  return address?.[1]?.trim().replace(/[.]+$/, "") || null;
}

function extractListingTitle(subject: string, body: string): string {
  const normalizedSubject = subject.trim();
  const genericSubject =
    /^(?:\d+\s+)?nuov[oi]\s+annunci?o(?:\s+per la tua ricerca(?:\s+.*)?)?$/i.test(normalizedSubject) ||
    /^notifica immobiliare senza oggetto$/i.test(normalizedSubject);

  if (!genericSubject) return subject;

  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/[\u200B-\u200D\uFEFF]/g, "").trim())
    .filter(Boolean);

  const listingLine = lines.find((line) =>
    /\b(appartament[oi]|villa|villetta|attico|rustico|casale|terreno|monolocale|bilocale|trilocale|quadrilocale|negozio|ufficio)\b/i.test(line) &&
    !/nuov[oi]\s+annunci?o\s+per la tua ricerca|case in vendita|la tua ricerca|gestisci ricerca|avvia ricerca/i.test(line)
  );

  return (listingLine || subject).slice(0, 180);
}

function getSenderDomain(from: string): string | null {
  const email = extractEmailAddress(from);
  if (!email) return null;
  return email.split("@")[1] ?? null;
}

export function buildDeduplicationKey(input: {
  urls: string[];
  sender: string;
  subject: string;
}): string {
  if (input.urls.length) return "url:" + canonicalUrl(input.urls[0]);
  const sender = extractEmailAddress(input.sender) ?? input.sender.toLowerCase();
  const subject = input.subject.toLowerCase().replace(/\s+/g, " ").trim();
  return "email:" + sender + "|" + subject;
}

export function parseListingEmail(message: GmailApiMessage): ListingCandidate {
  const subject = getHeader(message, "subject") || "Notifica immobiliare senza oggetto";
  const from = getHeader(message, "from");
  const body = extractGmailMessageText(message);
  const combined = [subject, body].filter(Boolean).join("\n");
  const extractedTitle = extractListingTitle(subject, body);
  const isAuction = /\ball['’]asta\b|\basta giudiziaria\b/i.test(extractedTitle + " " + body);
  const titolo = isAuction && !/^ASTA\s*[—-]/i.test(extractedTitle)
    ? "ASTA — " + extractedTitle
    : extractedTitle;
  const urls = extractUrls(combined);
  // Le conferme di ricerche salvate e le email di onboarding/sicurezza
  // possono contenere il nome del portale o parole immobiliari, ma non
  // rappresentano notifiche di nuovi annunci.
  const nonListingNotification =
    /\b(?:la tua )?ricerca\s+(?:è stata\s+)?salvat[ao]\b/i.test(subject) ||
    /\bbenvenut[oa]\b/i.test(subject) ||
    /\bhai condiviso alcuni dati dell['’]account google\b/i.test(subject) ||
    /\bverifica il tuo indirizzo email\b/i.test(subject) ||
    /\bavviso di sicurezza\b/i.test(subject);
  const keywordMatch = /immobil|annunci?o|casa|appartament|villetta|villa|terreno|vendita|vendesi|affitto|bilocale|trilocale|quadrilocale|monolocale|attico|rustico|commerciale|nuova costruzione|prezzo/i.test(combined);
  const likelyRealEstate = !nonListingNotification && keywordMatch;
  const warnings: string[] = [];
  if (nonListingNotification) {
    warnings.push("Email di conferma o configurazione, non una notifica di nuovi immobili: esclusa dalla coda.");
  } else if (!likelyRealEstate) {
    warnings.push("Email non chiaramente riconducibile a una notifica immobiliare: non importata automaticamente nella coda.");
  }

  if (!body) warnings.push("Il messaggio non contiene testo leggibile.");
  if (isAuction) warnings.push("Asta giudiziaria: verificare avviso di vendita, prezzo base e offerta minima; non classificare come vendita privata.");
  if (extractEmailAddress(from)) warnings.push("Il mittente è la casella che ha inviato la notifica: non è un contatto verificato del venditore.");
  if (!urls.length) warnings.push("Non è stato individuato un link all'annuncio.");
  if (!extractMunicipality(combined)) warnings.push("Comune non riconosciuto con certezza.");
  if (extractPrice(combined) === null) warnings.push("Prezzo non riconosciuto con certezza.");

  return {
    messageId: message.id ?? "",
    deduplicationKey: buildDeduplicationKey({ urls, sender: from, subject }),
    titolo,
    comune: extractMunicipality(combined),
    prezzo: extractPrice(combined),
    // Il mittente è il portale/notificatore, non necessariamente il venditore.
    contatto: null,
    notificationSender: extractEmailAddress(from),
    tipo_venditore: "Da verificare",
    portale: getSenderDomain(from),
    url: urls[0] ?? null,
    allUrls: urls,
    receivedAt: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : null,
    reviewStatus: "da_verificare",
    likelyRealEstate,
    warnings,
  };
}
