// NMRE ingestion lab: esperimento isolato, manuale e read-only.
// Una richiesta per volta; nessuna paginazione, retry, cookie, login o bypass anti-bot.
// L'host deve essere stato autorizzato esplicitamente tramite allowlist server-side.
// Il risultato è solo un'anteprima: nessuna scrittura su Supabase.
import { withSupabase } from "npm:@supabase/server@^1";
import { parsePublicListingPreview } from "./_shared/preview.ts";

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
      const items = parsePublicListingPreview(html, url.toString());
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
