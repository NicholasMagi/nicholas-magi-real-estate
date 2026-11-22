import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { idealistaSearchForm, toIdealistaCandidate } from "./provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://nicholasmagi.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function settings() {
  const apiKey = Deno.env.get("IDEALISTA_API_KEY");
  const apiSecret = Deno.env.get("IDEALISTA_API_SECRET");
  return {
    apiKey, apiSecret,
    center: Deno.env.get("IDEALISTA_CENTER") || "43.465,13.547",
    distance: Number(Deno.env.get("IDEALISTA_DISTANCE_METERS") || "50000"),
    configured: !!(apiKey && apiSecret)
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return reply({ success: false, error: "Metodo non consentito." }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ success: false, error: "Autenticazione richiesta." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabaseKey) return reply({ success: false, error: "Configurazione Supabase non disponibile." }, 500);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return reply({ success: false, error: "Sessione non valida." }, 401);

  const config = settings();
  if (req.method === "GET") {
    return reply({
      success: true,
      provider: "Idealista Search API",
      configured: config.configured,
      searchArea: "Centro predefinito: Castelfidardo, raggio 50 km",
      access: "Credenziali rilasciate da Idealista previa approvazione del progetto"
    });
  }

  if (!config.configured) {
    return reply({
      success: false, configured: false, code: "IDEALISTA_CREDENTIALS_MISSING",
      error: "Connettore predisposto. Idealista deve prima approvare la richiesta API e rilasciare API Key e Secret."
    }, 200);
  }
  if (!Number.isFinite(config.distance) || config.distance < 1000 || config.distance > 100000) {
    return reply({ success: false, error: "Raggio di ricerca configurato non valido." }, 500);
  }

  try {
    const basic = btoa(config.apiKey + ":" + config.apiSecret);
    const tokenResponse = await fetch("https://api.idealista.com/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "read" }),
      signal: AbortSignal.timeout(20000)
    });
    if (!tokenResponse.ok) {
      console.error("Idealista token request failed:", tokenResponse.status);
      throw new Error("Autenticazione Idealista non riuscita. Verificare credenziali e abilitazione Search API.");
    }
    const token = await tokenResponse.json();
    if (typeof token.access_token !== "string" || !token.access_token) throw new Error("Idealista non ha restituito un access token.");

    let pagesRead = 0;
    let resultsRead = 0;
    const candidates = new Map<string, Record<string, any>>();
    for (let page = 1; page <= 3; page++) {
      const response = await fetch("https://api.idealista.com/3.5/it/search", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token.access_token },
        body: idealistaSearchForm(page, config.center, config.distance),
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) {
        console.error("Idealista Search API failed:", response.status);
        throw new Error("Ricerca Idealista non riuscita. Verificare quota, area autorizzata e parametri API.");
      }
      const result = await response.json();
      const items = Array.isArray(result.elementList) ? result.elementList : [];
      pagesRead++;
      resultsRead += items.length;
      for (const item of items) {
        const candidate = toIdealistaCandidate(item, userData.user.id);
        if (candidate) candidates.set(candidate.dedup_key, candidate);
      }
      const totalPages = Number(result.totalPages || 1);
      if (page >= totalPages || items.length === 0) break;
    }

    const rows = [...candidates.values()];
    let inserted = 0;
    if (rows.length) {
      const { data, error } = await supabase.from("annunci_candidati")
        .upsert(rows, { onConflict: "owner_id,dedup_key", ignoreDuplicates: true })
        .select("id");
      if (error) {
        console.error("Idealista candidate save failed:", error.message);
        throw new Error("Risultati ricevuti da Idealista, ma non è stato possibile salvarli nella coda.");
      }
      inserted = data?.length ?? 0;
    }
    return reply({
      success: true, provider: "Idealista Search API", pagesRead, resultsRead,
      candidatesMatched: rows.length,
      privateRecognized: rows.filter(row => row.tipo_venditore === "Privato").length,
      needsReview: rows.filter(row => row.tipo_venditore === "Da verificare").length,
      inserted, alreadyPresent: Math.max(0, rows.length - inserted),
      note: "I contatti non vengono estratti. Il venditore resta Da verificare salvo metadati espliciti dell'API."
    });
  } catch (error) {
    console.error("Idealista sync error:", error instanceof Error ? error.message : "unknown error");
    return reply({ success: false, error: error instanceof Error ? error.message : "Errore ricerca Idealista." }, 502);
  }
});
