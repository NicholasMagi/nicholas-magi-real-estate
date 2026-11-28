import { municipality } from "../../nmre-gmail-scheduled/_shared/parser.ts";
import { normalizeMunicipality, territoryClassification } from "../../_shared/territory.ts";
import { municipality as parseMunicipality } from "../../nmre-gmail-scheduled/_shared/parser.ts";
import { parseSubitoResultsPage } from "../../nmre-gmail-scheduled/_shared/subito.ts";

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

/** Estrae solo dati strutturati esplicitamente pubblicati nella pagina. */
export function parsePublicListingPreview(html: string, pageUrl: string, allowed45MinuteMunicipalities: ReadonlySet<string> | null = null) {
  const blocks: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flattenJsonLd(JSON.parse(match[1]), blocks); } catch { /* JSON-LD malformato: ignora il blocco */ }
  }
  const candidates = blocks.filter(obj => {
    const type = Array.isArray(obj["@type"]) ? obj["@type"].join(" ") : String(obj["@type"] || "");
    return /RealEstateListing|Residence|House|Apartment|SingleFamilyResidence|Product/i.test(type) ||
      (!!obj["offers"] && (!!obj["address"] || !!obj["name"]));
  }).slice(0, 40);

  return candidates.map((obj, index) => {
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
      within_45_min: allowed45MinuteMunicipalities && town ? allowed45MinuteMunicipalities.has(normalizeMunicipality(town)) : null,
      price: offers["price"] ?? obj["price"] ?? null,
      currency: offers["priceCurrency"] ?? null,
      seller: "Da verificare",
      importable: false
    };
  });
}

/** Adattatore Subito: usa il parser di produzione, senza paginazione o richieste aggiuntive. */
export function parseSubitoPreview(html: string, allowed45MinuteMunicipalities: ReadonlySet<string> | null = null) {
  const page = parseSubitoResultsPage(html);
  const items = page.items.map((item, index) => {
    const town = parseMunicipality(String(item.location || ""));
    return {
      source_index: index + 1,
      title: item.title,
      description: item.description,
      url: item.url,
      locality: item.location,
      municipality: town,
      territory: territoryClassification(town),
      within_45_min: allowed45MinuteMunicipalities && town ? allowed45MinuteMunicipalities.has(normalizeMunicipality(town)) : null,
      price: item.price,
      currency: "EUR",
      seller: item.advertiserCompany === false ? "Privato" : item.advertiserCompany === true ? "Agenzia" : "Da verificare",
      importable: false
    };
  });
  return { page_status: page.status, page_source: page.source, skipped: page.skipped || 0, items };
}
