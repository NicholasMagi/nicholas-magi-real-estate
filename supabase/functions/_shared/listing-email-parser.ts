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

export function extractGmailMessageText(message: GmailApiMessage): string {
  const parts = { plain: [] as string[], html: [] as string[] };
  collectMimeParts(message.payload, parts);

  if (parts.plain.length) return parts.plain.join("\n\n").trim();
  if (parts.html.length) return parts.html.map(htmlToText).join("\n\n");
  return "";
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
  if (!Number.isFinite(number) || number < 10000 || number > 100000000) {
    return null;
  }
  return Math.round(number);
}

function extractPrice(text: string): number | null {
  const patterns = [
    /(?:prezzo|richiesta|prezzo richiesto)\s*[:\-]?\s*(?:€\s*)?([\d][\d.\s,]{3,})\s*€?/i,
    /€\s*([\d][\d.\s,]{3,})/i,
    /([\d][\d.\s,]{3,})\s*€/i,
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
  const match = text.match(
    /(?:comune|località|localita|ubicazione)\s*[:\-]\s*([^\n,;|]{2,70})/i
  );
  const value = match?.[1]?.trim().replace(/[.]+$/, "");
  return value || null;
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
  const urls = extractUrls(combined);
  const likelyRealEstate = /immobil|annunci?o|casa|appartament|villetta|villa|terreno|vendita|vendesi|affitto|bilocale|trilocale|quadrilocale|monolocale|attico|rustico|commerciale|nuova costruzione|prezzo/i.test(combined);
  const warnings: string[] = [];
  if (!likelyRealEstate) warnings.push("Email non chiaramente riconducibile a una notifica immobiliare: non importata automaticamente nella coda.");

  if (!body) warnings.push("Il messaggio non contiene testo leggibile.");
  if (extractEmailAddress(from)) warnings.push("Il mittente è la casella che ha inviato la notifica: non è un contatto verificato del venditore.");
  if (!urls.length) warnings.push("Non è stato individuato un link all'annuncio.");
  if (!extractMunicipality(combined)) warnings.push("Comune non riconosciuto con certezza.");
  if (extractPrice(combined) === null) warnings.push("Prezzo non riconosciuto con certezza.");

  return {
    messageId: message.id ?? "",
    deduplicationKey: buildDeduplicationKey({ urls, sender: from, subject }),
    titolo: subject,
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
