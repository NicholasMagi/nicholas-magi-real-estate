import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyExistingByListingId, collectInsightsListings, INSIGHTS_TIME_BUDGET_MS, planInsightsWrites } from "./sync.ts";
import type { ArchivedListing, ExistingCandidate, InsightsApi } from "./sync.ts";

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

  const accessToken: string = tokenData.access_token;
  cachedToken = accessToken;
  cachedTokenExpiresAt = Date.now() + Math.max(60, Number(tokenData.expires_in || 14400)) * 1000;
  return accessToken;
}

// Chiamata autenticata alla Comps API. Il token (valido 4 ore) viene riusato, come
// raccomanda la documentazione; con 401 (token scaduto o revocato) se ne chiede uno nuovo
// una sola volta.
async function insightsRequest(
  baseUrl: string,
  settings: ReturnType<typeof requiredSettings>,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<{ status: number; data: any }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const token = await getInsightsToken(baseUrl, settings);
    const response = await fetch(baseUrl + path, {
      method: init.method,
      headers: {
        "Authorization": "Bearer " + token,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    if (response.status === 401 && attempt === 1) {
      cachedToken = null;
      cachedTokenExpiresAt = 0;
      continue;
    }
    let data: any = null;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, data };
  }
  return { status: 401, data: null };
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

  // Il connettore usa un account API professionale unico: soltanto il proprietario NMRE
  // può verificare o avviare ricerche che consumano la relativa licenza.
  const allowedUserId = Deno.env.get("NMRE_ALLOWED_USER_ID");
  if (!allowedUserId) {
    console.error("NMRE_ALLOWED_USER_ID non configurato.");
    return reply({ success: false, error: "Connettore non configurato sul server." }, 503);
  }
  if (userData.user.id !== allowedUserId) {
    return reply({ success: false, error: "Account non autorizzato a usare il connettore API." }, 403);
  }

  const settings = requiredSettings();
  const leadUseApproved = Deno.env.get("INSIGHTS_LEAD_USE_APPROVED") === "true";
  const environment = Deno.env.get("NMRE_INSIGHTS_ENV") === "production" ? "production" : "sandbox";

  if (req.method === "GET") {
    return reply({
      success: true,
      provider: "Immobiliare.it Insights",
      configured: settings.configured,
      leadUseApproved,
      canImport: settings.configured && leadUseApproved,
      environment,
      capabilities: ["ricerca degli annunci in vendita pubblicati da privati (fullSearchByAttribute, clientTypeID=1)", "annotazione del filtro phoneNumberProvided (l'API non restituisce numeri di telefono)", "tipo di inserzionista dei candidati già presenti tramite dettaglio per ID annuncio", "confronto con Opportunità, Scartati e Archivio per evitare duplicati"],
      missingSecrets: [
        ["INSIGHTS_CLIENT_ID", settings.clientId],
        ["INSIGHTS_CLIENT_SECRET", settings.clientSecret],
        ["INSIGHTS_USERNAME", settings.username],
        ["INSIGHTS_PASSWORD", settings.password]
      ].filter((entry) => !entry[1]).map((entry) => entry[0])
    });
  }

  if (!leadUseApproved) {
    return reply({
      success: false,
      configured: settings.configured,
      code: "INSIGHTS_LEAD_USE_NOT_APPROVED",
      error: "Prima di importare i risultati per finalità di acquisizione immobiliare, occorre una conferma scritta di Immobiliare.it Insights che autorizzi espressamente questo utilizzo."
    }, 200);
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
    const startedAt = Date.now();
    const nowIso = new Date().toISOString();
    const api: InsightsApi = {
      search: (endpoint, body) => insightsRequest(baseUrl, settings, "/comparables/" + endpoint, { method: "POST", body }),
      detailByListingId: (listingId) => insightsRequest(baseUrl, settings, "/comparable/id/" + encodeURIComponent(listingId), { method: "GET" })
    };

    // 1) Ricerca degli annunci di privati (dettaglio completo in un'unica chiamata per pagina).
    const collection = await collectInsightsListings(api, { now: new Date(), lookbackDays });
    if (collection.status === "errore") {
      return reply({
        success: false,
        code: "INSIGHTS_SEARCH_FAILED",
        provider: "Immobiliare.it Insights",
        environment,
        searches: collection.searches,
        inserted: 0,
        error: "Ricerca Immobiliare.it Insights non riuscita: nessun annuncio importato e nessun dato modificato."
      }, 200);
    }

    // 2) Annunci già presenti in NMRE (tutti gli stati) e Archivio: senza una lettura
    //    completa non si inserisce nulla.
    const existingCandidates: ExistingCandidate[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data: page, error } = await supabase
        .from("annunci_candidati")
        .select("id,url,url_originale,listing_key,dedup_key,stato,seller_manual_override,seller_evidence,seller_classification_version")
        .eq("owner_id", userData.user.id)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error("Lettura delle opportunità già raccolte non riuscita: nessun annuncio importato.");
      existingCandidates.push(...(page || []));
      if (!page || page.length < pageSize) break;
    }
    const archive: ArchivedListing[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data: page, error } = await supabase
        .from("annunci")
        .select("id,url,listing_key,deleted_at")
        .eq("owner_id", userData.user.id)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error("Lettura dell'Archivio non riuscita: nessun annuncio importato.");
      archive.push(...(page || []));
      if (!page || page.length < pageSize) break;
    }

    // 3) Cosa scrivere: solo annunci nuovi e conferme del venditore su candidati in attesa.
    const plan = planInsightsWrites(collection, { candidates: existingCandidates, archive }, { ownerId: userData.user.id, nowIso });

    let inserted = 0;
    let insertRaces = 0;
    const insertFailures: string[] = [];
    for (const row of plan.inserts) {
      const { error } = await supabase.from("annunci_candidati").insert(row).select("id");
      if (!error) inserted++;
      else if (error.code === "23505") insertRaces++;
      else insertFailures.push(error.message.slice(0, 160));
    }

    let matchedAsPrivate = 0;
    if (plan.privateUpdateIds.length) {
      const { data, error } = await supabase
        .from("annunci_candidati")
        .update({
          tipo_venditore: "Privato",
          seller_confidence: 99,
          seller_evidence: "Immobiliare.it Insights: stesso annuncio restituito dalla ricerca ufficiale clientTypeID=1 (Privato)",
          seller_classification_version: 4,
          updated_at: nowIso
        })
        .eq("owner_id", userData.user.id)
        .eq("stato", "da_verificare")
        .eq("seller_manual_override", false)
        .in("id", plan.privateUpdateIds)
        .select("id");
      if (error) throw new Error("Aggiornamento dei venditori privati riconosciuti non riuscito.");
      matchedAsPrivate = data?.length ?? 0;
    }

    // 4) Candidati già presenti (per esempio arrivati via Gmail): tipo di inserzionista dal
    //    dettaglio per ID annuncio. Nessuna opportunità viene scartata automaticamente.
    const detailCheck = await classifyExistingByListingId(api, existingCandidates, {
      exclude: new Set(plan.privateUpdateIds), deadline: startedAt + INSIGHTS_TIME_BUDGET_MS + 20_000
    });
    let detailPrivate = 0;
    let detailProfessional = 0;
    for (const result of detailCheck.results) {
      const update = result.clientType === "Privato"
        ? { tipo_venditore: "Privato", seller_confidence: 99, seller_evidence: "Immobiliare.it Insights: dettaglio dell'annuncio con clientType «Privato»", seller_classification_version: 4, updated_at: nowIso }
        : { tipo_venditore: "Da verificare", seller_confidence: 0, seller_evidence: "Immobiliare.it Insights: dettaglio dell'annuncio con clientType «Professionista»; conferma manuale necessaria", seller_classification_version: 4, updated_at: nowIso };
      const { data, error } = await supabase
        .from("annunci_candidati")
        .update(update)
        .eq("owner_id", userData.user.id)
        .eq("id", result.id)
        .eq("stato", "da_verificare")
        .eq("seller_manual_override", false)
        .select("id");
      if (error) continue;
      if (data?.length) result.clientType === "Privato" ? detailPrivate++ : detailProfessional++;
    }

    return reply({
      success: true,
      provider: "Immobiliare.it Insights",
      environment,
      lookbackDays,
      endpoint: "fullSearchByAttribute",
      completeness: collection.status,
      searches: collection.searches,
      privateListingsInArea: collection.privateItems.size,
      phoneFlagged: collection.phoneFlagged.size,
      phoneSearchComplete: collection.phoneSearchComplete,
      outOfArea: collection.outOfArea,
      unusableItems: collection.unusable,
      declaredProfessionalInPrivateSearch: collection.declaredProfessional,
      inserted,
      insertRaces,
      insertFailures: insertFailures.length,
      alreadyPresent: plan.alreadyPresent,
      untouchedDecisions: plan.untouchedDecisions,
      untouchedManual: plan.untouchedManual,
      alreadyInArchive: plan.archived.length,
      matchedAsPrivate,
      detailChecked: detailCheck.checked,
      detailFailed: detailCheck.failed,
      detailPrivate,
      detailProfessional,
      note: "Importati come «Da verificare» gli annunci di privati in area non ancora presenti in NMRE né nell'Archivio. Le decisioni e le modifiche manuali non vengono toccate. L'API non restituisce numeri di telefono: il recapito va verificato aprendo l'annuncio." +
        (collection.status === "parziale" ? " Ricerca parziale: non tutte le pagine sono state lette (vedi searches); ripetere con un periodo più breve." : "")
    });
  } catch (error) {
    console.error("Immobiliare Insights sync error:", error instanceof Error ? error.message : "unknown error");
    return reply({
      success: false,
      error: error instanceof Error ? error.message : "Errore durante la ricerca API."
    }, 502);
  }
});
