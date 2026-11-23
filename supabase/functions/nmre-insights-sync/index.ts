import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildInsightsSearchPayload, toCandidate } from "./provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://nicholasmagi.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function requiredSettings() {
  const clientId = Deno.env.get("INSIGHTS_CLIENT_ID");
  const clientSecret = Deno.env.get("INSIGHTS_CLIENT_SECRET");
  const username = Deno.env.get("INSIGHTS_USERNAME");
  const password = Deno.env.get("INSIGHTS_PASSWORD");
  return {
    clientId, clientSecret, username, password,
    configured: !!(clientId && clientSecret && username && password)
  };
}

async function getInsightsToken(
  baseUrl: string,
  settings: ReturnType<typeof requiredSettings>
): Promise<string> {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;
  if (!settings.clientId || !settings.clientSecret || !settings.username || !settings.password) {
    throw new Error("Credenziali API non configurate.");
  }

  const response = await fetch(baseUrl + "/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(settings.clientId + ":" + settings.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: settings.username,
      password: settings.password
    }),
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    console.error("Immobiliare Insights token request failed:", response.status);
    throw new Error("Autenticazione Immobiliare.it Insights non riuscita. Verificare credenziali e abilitazione Comps Finder.");
  }

  const tokenData = await response.json();
  if (typeof tokenData.access_token !== "string" || !tokenData.access_token) {
    throw new Error("La risposta di autenticazione Insights non contiene un access token.");
  }

  cachedToken = tokenData.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max(60, Number(tokenData.expires_in || 14400)) * 1000;
  return cachedToken;
}

async function fetchComparableDetail(baseUrl: string, token: string, uuid: string) {
  const response = await fetch(baseUrl + "/comparable/" + encodeURIComponent(uuid), {
    headers: { "Authorization": "Bearer " + token },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    console.error("Insights comparable detail failed:", response.status);
    return null;
  }
  const detail = await response.json();
  return detail && typeof detail === "object" ? detail : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return reply({ success: false, error: "Metodo non consentito." }, 405);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return reply({ success: false, error: "Autenticazione richiesta." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabaseKey) {
    return reply({ success: false, error: "Configurazione Supabase non disponibile." }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return reply({ success: false, error: "Sessione non valida." }, 401);
  }

  const settings = requiredSettings();
  const environment = Deno.env.get("NMRE_INSIGHTS_ENV") === "production" ? "production" : "sandbox";

  if (req.method === "GET") {
    return reply({
      success: true,
      provider: "Immobiliare.it Insights",
      configured: settings.configured,
      environment,
      capabilities: ["offerte residenziali in vendita", "venditore privato", "disponibilità numero telefonico"],
      missingSecrets: [
        ["INSIGHTS_CLIENT_ID", settings.clientId],
        ["INSIGHTS_CLIENT_SECRET", settings.clientSecret],
        ["INSIGHTS_USERNAME", settings.username],
        ["INSIGHTS_PASSWORD", settings.password]
      ].filter((entry) => !entry[1]).map((entry) => entry[0])
    });
  }

  if (!settings.configured) {
    return reply({
      success: false,
      configured: false,
      code: "INSIGHTS_CREDENTIALS_MISSING",
      error: "Connettore predisposto. Mancano le credenziali API ufficiali di Immobiliare.it Insights."
    }, 200);
  }

  let lookbackDays = 30;
  try {
    const body = await req.json();
    if (body?.lookbackDays !== undefined) {
      const value = Number(body.lookbackDays);
      if (!Number.isInteger(value) || value < 1 || value > 90) {
        return reply({ success: false, error: "Intervallo di ricerca non valido (1–90 giorni)." }, 400);
      }
      lookbackDays = value;
    }
  } catch {
    // Empty body uses the default 30-day window.
  }

  const baseUrl = environment === "production"
    ? "https://comparables.realitycs.it"
    : "https://sandbox-comparables.realitycs.it";

  try {
    const token = await getInsightsToken(baseUrl, settings);
    const candidates = new Map<string, Record<string, any>>();
    let resultsRead = 0;
    let detailRead = 0;
    let detailsFailed = 0;
    let pagesRead = 0;
    const maxPages = 5;

    for (let page = 1; page <= maxPages; page++) {
      const response = await fetch(baseUrl + "/comparables/searchByAttribute", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildInsightsSearchPayload(new Date(), lookbackDays, page)),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        console.error("Immobiliare Insights search failed:", response.status);
        throw new Error("Ricerca Insights non riuscita. Verificare che l'account abiliti Comps Finder e i filtri richiesti.");
      }

      const result = await response.json();
      const items = Array.isArray(result.items) ? result.items : [];
      pagesRead++;
      resultsRead += items.length;

      for (let offset = 0; offset < items.length; offset += 4) {
        const batch = items.slice(offset, offset + 4);
        const details = await Promise.all(batch.map(async (item: Record<string, any>) => {
          const uuid = typeof item.uuid === "string" ? item.uuid.trim() : "";
          if (!uuid) return null;
          return await fetchComparableDetail(baseUrl, token, uuid);
        }));

        for (const detail of details) {
          if (!detail) {
            detailsFailed++;
            continue;
          }
          detailRead++;
          const candidate = toCandidate(detail, userData.user.id);
          if (candidate) candidates.set(candidate.dedup_key, candidate);
        }
      }

      const lastPage = Number(result?._metadata?.pages?.last || page);
      if (page >= lastPage || items.length === 0) break;
    }

    const rows = [...candidates.values()];
    let inserted = 0;
    if (rows.length) {
      const { data, error } = await supabase
        .from("annunci_candidati")
        .upsert(rows, { onConflict: "owner_id,dedup_key", ignoreDuplicates: true })
        .select("id");
      if (error) {
        console.error("Immobiliare Insights candidate save failed:", error.message);
        throw new Error("Risultati ricevuti, ma non è stato possibile salvarli nella coda candidati.");
      }
      inserted = data?.length ?? 0;
    }

    return reply({
      success: true,
      provider: "Immobiliare.it Insights",
      environment,
      lookbackDays,
      pagesRead,
      resultsRead,
      detailRead,
      detailsFailed,
      candidatesMatched: rows.length,
      privateCandidatesMatched: rows.filter((row) => row.tipo_venditore === "Privato").length,
      candidatesNeedingReview: rows.filter((row) => row.tipo_venditore === "Da verificare").length,
      inserted,
      alreadyPresent: Math.max(0, rows.length - inserted),
      note: "La ricerca utilizza i filtri ufficiali clientTypeID=1 (Privato) e phoneNumberProvided=true. Il numero telefonico non è restituito dal mapping API documentato: il link dell'annuncio resta il canale di contatto."
    });
  } catch (error) {
    console.error("Immobiliare Insights sync error:", error instanceof Error ? error.message : "unknown error");
    return reply({
      success: false,
      error: error instanceof Error ? error.message : "Errore durante la ricerca API."
    }, 502);
  }
});
