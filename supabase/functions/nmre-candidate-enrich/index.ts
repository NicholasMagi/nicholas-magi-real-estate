function corsHeadersFor(req: Request): HeadersInit {
  const origin = req.headers.get("Origin");
  const isGitHubPages = origin === "https://nicholasmagi.github.io";
  const isVercelProduction = origin === "https://nicholas-magi-real-estate.vercel.app";
  // Allow only this Vercel project’s branch-preview hostnames, not arbitrary *.vercel.app sites.
  const isVercelPreview = !!origin && /^https:\/\/nicholas-magi-real-estate-git-[a-z0-9-]+-nicholasmagi\.vercel\.app$/i.test(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && (isGitHubPages || isVercelProduction || isVercelPreview)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

const ALLOWED_HOSTS = [
  "immobiliare.it",
  "idealista.it",
  "casa.it",
  "wikicasa.it",
  "subito.it",
  "casa.trovit.it",
];

function reply(data: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...(req ? corsHeadersFor(req) : {}), "Content-Type": "application/json" },
  });
}

function allowedUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    const host = url.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.some((domain) => host === domain || host.endsWith("." + domain))) return null;
    return url;
  } catch {
    return null;
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("Pagina troppo grande per l'analisi automatica.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Pagina troppo grande per l'analisi automatica.");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(joined);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}

function cleanText(value: unknown, max = 250): string | null {
  if (typeof value !== "string") return null;
  const cleaned = decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    return numeric(obj.value ?? obj.minValue ?? obj.maxValue);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function metaTags(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const attrs: Record<string, string> = {};
    for (const attr of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[attr[1].toLowerCase()] = decodeHtml(attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key && attrs.content) result[key] = attrs.content;
  }
  return result;
}

function flattenJsonLd(value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => flattenJsonLd(entry, output));
  } else if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    output.push(item);
    if (item["@graph"]) flattenJsonLd(item["@graph"], output);
  }
  return output;
}

function findValue(nodes: Record<string, unknown>[], keys: string[]): unknown {
  for (const node of nodes) {
    for (const key of keys) {
      if (node[key] !== undefined && node[key] !== null && node[key] !== "") return node[key];
    }
  }
  return null;
}

function normalizeType(value: unknown): string | null {
  const raw = Array.isArray(value) ? value.join(" ") : String(value || "");
  const lower = raw.toLowerCase();
  if (lower.includes("singlefamily") || lower.includes("house") || lower.includes("residence")) return "Casa indipendente";
  if (lower.includes("apartment") || lower.includes("residence")) return "Appartamento";
  if (lower.includes("villa")) return "Villa";
  if (lower.includes("land") || lower.includes("plot")) return "Terreno";
  return null;
}

async function fetchPage(initial: URL): Promise<{ html: string; finalUrl: string }> {
  let current = initial;
  for (let hop = 0; hop <= 2; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(current.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "NMRE-public-listing-review/1.0",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === 2) throw new Error("Il portale ha reindirizzato la pagina in modo non verificabile.");
      const next = allowedUrl(new URL(location, current).href);
      if (!next) throw new Error("Il portale ha reindirizzato verso un dominio non autorizzato.");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error("Il portale non consente la lettura della pagina (HTTP " + response.status + ").");
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error("La risorsa non è una pagina HTML pubblica.");
    return { html: await readLimited(response, 1_500_000), finalUrl: current.href };
  }
  throw new Error("Pagina non raggiungibile.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  if (req.method !== "POST") return reply({ success: false, error: "Metodo non consentito." }, 405, req);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return reply({ success: false, error: "Autenticazione richiesta." }, 401, req);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!supabaseUrl || !supabaseKey) return reply({ success: false, error: "Configurazione non disponibile." }, 500, req);

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return reply({ success: false, error: "Sessione non valida." }, 401, req);

    const body = await req.json();
    if (typeof body?.url !== "string" || body.url.length > 2000) return reply({ success: false, error: "Link annuncio non valido." }, 400, req);
    const initial = allowedUrl(body.url);
    if (!initial) return reply({ success: false, error: "Per sicurezza sono ammessi solo link HTTPS dei portali immobiliari supportati." }, 400, req);

    const { html, finalUrl } = await fetchPage(initial);
    const meta = metaTags(html);
    const nodes: Record<string, unknown>[] = [];
    for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { flattenJsonLd(JSON.parse(match[1].trim()), nodes); } catch { /* JSON-LD incompleto: prosegue con gli altri dati pubblici. */ }
    }

    const address = findValue(nodes, ["address"]);
    const addressObj = address && typeof address === "object" ? address as Record<string, unknown> : {};
    const offers = findValue(nodes, ["offers"]);
    const offerObj = Array.isArray(offers) ? (offers[0] || {}) as Record<string, unknown> : (offers && typeof offers === "object" ? offers as Record<string, unknown> : {});
    const floor = findValue(nodes, ["floorSize"]);
    const listingNodes = nodes.filter((node) => {
      const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : String(node["@type"] || "");
      return /apartment|house|singlefamily|residence|product|realestate|accommodation/i.test(type);
    });
    const sourceNodes = listingNodes.length ? listingNodes : nodes;
    const sourceAddress = findValue(sourceNodes, ["address"]);
    const sourceAddressObj = sourceAddress && typeof sourceAddress === "object" ? sourceAddress as Record<string, unknown> : addressObj;
    const sourceOffers = findValue(sourceNodes, ["offers"]);
    const sourceOfferObj = Array.isArray(sourceOffers) ? (sourceOffers[0] || {}) as Record<string, unknown> : (sourceOffers && typeof sourceOffers === "object" ? sourceOffers as Record<string, unknown> : offerObj);
    const sourceFloor = findValue(sourceNodes, ["floorSize"]) || floor;
    const suggestions = {
      titolo: cleanText(findValue(sourceNodes, ["name", "headline"]) || meta["og:title"] || meta["twitter:title"], 250),
      comune: cleanText(sourceAddressObj.addressLocality || sourceAddressObj.addressRegion || meta["og:locality"], 120),
      prezzo: numeric(findValue(sourceNodes, ["price"]) || sourceOfferObj.price || meta["product:price:amount"]),
      tipologia_immobile: normalizeType(sourceNodes.map((node) => node["@type"])),
      superficie_mq: numeric(sourceFloor),
      locali: numeric(findValue(sourceNodes, ["numberOfRooms", "numberOfRoomsTotal"])),
      camere: numeric(findValue(sourceNodes, ["numberOfBedrooms"])),
      bagni: numeric(findValue(sourceNodes, ["numberOfBathroomsTotal", "numberOfBathrooms"])),
    };
    const hasSuggestions = Object.values(suggestions).some((value) => value !== null && value !== undefined && value !== "");
    return reply({
      success: true,
      found: hasSuggestions,
      suggestions,
      evidence: nodes.length ? "Dati strutturati Schema.org / JSON-LD e metadati pubblici" : "Metadati pubblici Open Graph",
      final_url: finalUrl,
      retrieved_at: new Date().toISOString(),
      message: hasSuggestions ? "Analisi completata: verificare i valori prima del salvataggio." : "Nessun dato strutturato disponibile.",
    }, 200, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore durante l'analisi della pagina.";
    console.error("nmre-candidate-enrich:", message);
    return reply({ success: false, error: message }, 422, req);
  }
});
