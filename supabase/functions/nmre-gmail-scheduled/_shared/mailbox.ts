// Lettura dei messaggi Gmail e smistamento delle email della casella (usati da index.ts e
// dai test, sullo stesso codice): testo e HTML del messaggio, email Subito di ricerca
// salvata, regola del filtro avvisi, venditore del riepilogo, email da rielaborare.
import { propertyEmailDecision } from "./parser.ts";
import type { PropertyEmailRule } from "./parser.ts";
import { subitoSavedSearchDigest } from "./subito.ts";
import type { SubitoDigest } from "./subito.ts";

// deno-lint-ignore no-explicit-any
type GmailPart = any;

function decode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Uint8Array.from(binary, character => character.charCodeAt(0))
  );
}

// HTML originale dell'email (serve per leggere il link dei pulsanti, per esempio
// "Vedi i nuovi annunci" delle ricerche salvate Subito).
export function htmlParts(part: GmailPart): string[] {
  const output: string[] = [];
  if (part?.body?.data && part.mimeType === "text/html") output.push(decode(part.body.data));
  for (const child of part?.parts || []) output.push(...htmlParts(child));
  return output;
}

export function bodyParts(part: GmailPart): string[] {
  const output: string[] = [];
  if (part?.body?.data && part.mimeType === "text/plain") {
    output.push(decode(part.body.data));
  } else if (part?.body?.data && part.mimeType === "text/html") {
    const html = decode(part.body.data)
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
      .replace(/<\s*a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, " $1 ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
    output.push(html);
  }
  for (const child of part?.parts || []) output.push(...bodyParts(child));
  return output;
}

export type MailboxEmail = {
  id: string; labels: string[]; from: string; subject: string; date: string;
  messageIdHeader: string; snippet: string; bodyText: string; bodyHtml: string;
};

/** Messaggio dell'API Gmail (format=full) → email usata dalla sincronizzazione. */
// deno-lint-ignore no-explicit-any
export function emailFromGmailMessage(email: any): MailboxEmail {
  const headers = email.payload?.headers || [];
  const get = (name: string) =>
    // deno-lint-ignore no-explicit-any
    headers.find((header: any) => header.name?.toLowerCase() === name.toLowerCase())?.value || "";
  return {
    id: email.id,
    labels: Array.isArray(email.labelIds) ? email.labelIds : [],
    from: get("From"),
    subject: get("Subject"),
    date: get("Date"),
    messageIdHeader: get("Message-ID").slice(0, 300),
    snippet: (email.snippet || "").slice(0, 500),
    bodyText: bodyParts(email.payload).join("\n").slice(0, 30000),
    bodyHtml: htmlParts(email.payload).join("\n").slice(0, 300000)
  };
}

export type MailboxClassification = {
  subitoDigestById: Map<string, SubitoDigest>;
  filterRuleById: Map<string, PropertyEmailRule>;
  /** Diagnostica del filtro: solo conteggi per nome di regola, nessun testo. */
  propertyFilterRules: Record<string, number>;
};

/**
 * Email Subito di ricerca salvata: riconosciute a parte e accettate. Il filtro generico
 * le escluderebbe (nell'email reale la parte di testo contiene "Ricerca salvata:", che
 * il filtro tratta come conferma di salvataggio; il link è una pagina di risultati).
 */
// deno-lint-ignore no-explicit-any
export function classifyMailbox(emails: any[]): MailboxClassification {
  const subitoDigestById = new Map<string, SubitoDigest>();
  const filterRuleById = new Map<string, PropertyEmailRule>();
  const propertyFilterRules: Record<string, number> = {};
  for (const email of emails) {
    const digest = subitoSavedSearchDigest(email);
    if (digest) subitoDigestById.set(String(email.id), digest);
  }
  for (const email of emails) {
    const decision = subitoDigestById.has(String(email.id))
      ? { accepted: true, rule: "accettata" as PropertyEmailRule }
      : propertyEmailDecision(email);
    filterRuleById.set(String(email.id), decision.rule);
    propertyFilterRules[decision.rule] = (propertyFilterRules[decision.rule] || 0) + 1;
  }
  return { subitoDigestById, filterRuleById, propertyFilterRules };
}

/**
 * Venditore di un'email accettata. Il riepilogo di una ricerca salvata non è un annuncio:
 * l'etichetta "Inserzionista: Privato" descrive il filtro della ricerca (che comprende
 * anche i professionisti), non un venditore. Mai "Privato" → mai archiviazione automatica.
 */
export function sellerForEmail<T>(
  emailId: string,
  subitoDigestById: Map<string, SubitoDigest>,
  classify: () => T
): T | { classification: "Da verificare"; confidence: number; evidence: string } {
  return subitoDigestById.has(emailId)
    ? { classification: "Da verificare", confidence: 0, evidence: "Email riepilogativa di una ricerca salvata Subito" }
    : classify();
}

/**
 * Email da rileggere per un candidato da rielaborare. Gli annunci recuperati da una
 * ricerca salvata Subito hanno l'identificativo "<email>#subito-<annuncio>": si rilegge
 * l'email riepilogativa (Gmail non conosce l'identificativo composto).
 */
export function repairEmailId(sourceEmailId: unknown): string {
  return String(sourceEmailId || "").split("#")[0];
}
