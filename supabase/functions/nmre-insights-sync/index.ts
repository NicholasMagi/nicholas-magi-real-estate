import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildInsightsSearchPayload, toCandidate } from "./provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://nicholasmagi.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

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
  return { clientId, clientSecret, username, password, configured: !!(clientId && clientSecret && username && password) };
}

async function getInsightsToken(baseUrl: string, settings: ReturnType<typeof requiredSettings>): Promise<string> {
  const credentials = btoa(settings.clientId + ":" + settings.clientSecret);
  const response = await fetch(baseUrl + "/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + credentials,
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
    throw new Error("Autenticazione Immobiliare.it Insights non riuscita. Verificare credenziali e abilitazione API.");
  }
  const tokenData = await response.json();
  if (typeof tokenData.access_token !== "string" || !tokenData.access_token) {
    throw new Error("La risposta di autenticazione Insights non contiene un access token.");
  }
  return tokenData.access_token;
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
  if (req.method === "GET") {
    return reply({
      success: true,
      provider: "Immobiliare.it Insights",
      configured: settings.configured,
      environment: Deno.env.get("NMRE_INSIGHTS_ENV") === "production" ? "production" : "sandbox"
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
    // Empty JSON body uses the default 30-day window.
  }

  const baseUrl = Deno.env.get("NMRE_INSIGHTS_ENV") === "production"
    ? "https://comparables.realitycs.it"
    : "https://sandbox-comparables.realitycs.it";

  try {
    const token = await getInsightsToken(baseUrl, settings);
    const importedCandidates: Record<string, any>[] = [];
    let totalResults = 0;
    let pagesRead = 0;

    for (let page = 1; page <= 3; page++) {
      const response = await fetch(baseUrl + "/comparables/fullSearchByAttribute", {
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
        throw new Error("Ricerca annunci Insights non riuscita. Verificare che il piano abiliti Comps Finder e il filtro privati.");
      }

      const result = await response.json();
      const items = Array.isArray(result.items) ? result.items : [];
      pagesRead++;
      totalResults += items.length;

      for (const item of items) {
        const candidate = toCandidate(item, userData.user.id);
        if (candidate) importedCandidates.push(candidate);
      }

      const nextPage = result?._metadata?.pages?.next;
      if (!nextPage || page >= 3) break;
    }

    const unique = new Map<string, Record<string, any>>();
    for (const candidate of importedCandidates) unique.set(candidate.dedup_key, candidate);
    const rows = [...unique.values()];

    let inserted = 0;
    if (rows.length) {
      const { data, error } = await supabase
        .from("annunci_candidati")
        .upsert(rows, { onConflict: "owner_id,dedup_key", ignoreDuplicates: true })
        .select("id");
      if (error) {
        console.error("Immobiliare Insights candidate save failed:", error.message);
        throw new Error("I risultati API sono arrivati, ma non è stato possibile salvarli nella coda candidati.");
      }
      inserted = data?.length ?? 0;
    }

    return reply({
      success: true,
      provider: "Immobiliare.it Insights",
      environment: Deno.env.get("NMRE_INSIGHTS_ENV") === "production" ? "production" : "sandbox",
      lookbackDays,
      pagesRead,
      resultsRead: totalResults,
      privateCandidatesMatched: rows.filter(row => row.tipo_venditore === "Privato").length,
      candidatesNeedingReview: rows.filter(row => row.tipo_venditore === "Da verificare").length,
      inserted,
      alreadyPresent: Math.max(0, rows.length - inserted),
      note: "Il numero telefonico non viene restituito dal mapping API documentato: il link del portale resta la via di contatto."
    });
  } catch (error) {
    console.error("Immobiliare Insights sync error:", error instanceof Error ? error.message : "unknown error");
    return reply({
      success: false,
      error: error instanceof Error ? error.message : "Errore durante la ricerca API."
    }, 502);
  }
});
