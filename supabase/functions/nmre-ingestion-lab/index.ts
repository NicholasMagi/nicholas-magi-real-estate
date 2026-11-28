// NMRE ingestion lab: esperimento isolato, manuale e read-only.
// Una richiesta per volta; nessuna paginazione, retry, cookie, login o bypass anti-bot.
// L'host deve essere stato autorizzato esplicitamente tramite allowlist server-side.
// Il risultato è solo un'anteprima: nessuna scrittura su Supabase.
import { withSupabase } from "npm:@supabase/server@^1";
import { municipality } from "../nmre-gmail-scheduled/_shared/parser.ts";
import { territoryClassification } from "../_shared/territory.ts";

const MAX_HTML_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 10_000;

function allowedHosts(): Set<string> {
  return new Set((Deno.env.get("NMRE_INGESTION_ALLOWED_HOSTS") || "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
}

function safeUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
        url.hostname.endsWith(".local") || /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) return null;
    return url;
  } catch { return null; }
}

function textContent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 1000) : null;
}

function flattenJsonLd(value: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(value)) { for (const item of value) flattenJsonLd(item, out); return; }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  out.push(obj);
  if (obj["@graph"]) flattenJsonLd(obj["@graph"], out);
  if (obj["mainEntity"]) flattenJsonLd(obj["mainEntity"], out);
  if (obj["itemListElement"]) flattenJsonLd(obj["itemListElement"], out);
}

function parsePreview(html: string, pageUrl: string) {
  const blocks: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flattenJsonLd(JSON.parse(match[1]), blocks); } catch { /* JSON-LD malformato: ignora il blocco */ }
  }
  const candidates = blocks.filter(obj => {
    const type = Array.isArray(obj["@type"]) ? obj["@type"].join(" ") : String(obj["@type"] || "");
    return /RealEstateListing|Residence|House|Apartment|SingleFamilyResidence|Product/i.test(type) ||
      (!!obj["offers"] && (!!obj["address"] || !!obj["name"]));
  }).slice(0, 40);

  const items = candidates.map((obj, index) => {
    const address = (obj["address"] && typeof obj["address"] === "object")
      ? obj["address"] as Record<string, unknown> : {};
    const locality = textContent(address["addressLocality"] || address["addressRegion"] || obj["location"]);
    const town = locality ? municipality(locality) : null;
    const offers = (obj["offers"] && typeof obj["offers"] === "object")
      ? obj["offers"] as Record<string, unknown> : {};
    const rawUrl = textContent(obj["url"] || obj["@id"]);
    let listingUrl: string | null = null;
    try { listingUrl = rawUrl ? new URL(rawUrl, pageUrl).toString() : null; } catch { /* URL non valida */ }
    return {
      source_index: index + 1,
      title: textContent(obj["name"] || obj["headline"]),
      description: textContent(obj["description"]),
      url: listingUrl,
      locality,
      municipality: town,
      territory: territoryClassification(town),
      price: offers["price"] ?? obj["price"] ?? null,
      currency: offers["priceCurrency"] ?? null,
      seller: "Da verificare",
      importable: false
    };
  });
  return items;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Metodo non consentito" }, { status: 405 });
    const owner = Deno.env.get("NMRE_ALLOWED_USER_ID");
    if (!owner || ctx.userClaims?.id !== owner) return Response.json({ error: "Non autorizzato" }, { status: 403 });
    if (Deno.env.get("NMRE_PUBLIC_INGESTION_LAB_ENABLED") !== "true") {
      return Response.json({ error: "Esperimento disabilitato lato server" }, { status: 403 });
    }
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return Response.json({ error: "JSON non valido" }, { status: 400 }); }
    const url = safeUrl(body.url);
    if (!url) return Response.json({ error: "URL HTTPS pubblica non valida" }, { status: 400 });
    const hosts = allowedHosts();
    if (!hosts.has(url.hostname)) {
      return Response.json({ error: "Dominio non presente nell'allowlist approvata", host: url.hostname }, { status: 403 });
    }

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { "Accept": "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (response.status >= 300 && response.status < 400) {
        return Response.json({ error: "Redirect non seguito: occorre verificare manualmente la destinazione", status: response.status }, { status: 422 });
      }
      const type = response.headers.get("content-type") || "";
      if (!response.ok) return Response.json({ error: "Pagina non accessibile", status: response.status }, { status: 422 });
      if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
        return Response.json({ error: "La risorsa non è una pagina HTML pubblica", content_type: type }, { status: 415 });
      }
      const html = (await response.text()).slice(0, MAX_HTML_BYTES);
      const items = parsePreview(html, url.toString());
      return Response.json({
        mode: "preview_read_only",
        source_host: url.hostname,
        http_status: response.status,
        bytes_examined: Math.min(new TextEncoder().encode(html).length, MAX_HTML_BYTES),
        candidates_found: items.length,
        items,
        writes: 0,
        pagination: false,
        retries: 0,
        note: "Anteprima sperimentale: verificare condizioni d'uso e copertura dei dati prima di autorizzare il dominio o l'importazione."
      });
    } catch (error) {
      return Response.json({ error: "Lettura non riuscita", detail: error instanceof Error ? error.message : "Errore sconosciuto" }, { status: 502 });
    }
  })
};
