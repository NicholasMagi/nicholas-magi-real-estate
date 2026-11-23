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

function canonicalImmobiliareUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    if (url.protocol !== "https:" || host !== "immobiliare.it") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2 || segments[0].toLowerCase() !== "annunci") return null;
    if (!/^[0-9]+$/.test(segments[1])) return null;
    return "immobiliare.it/annunci/" + segments[1];
  } catch {
    return null;
  }
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
      capabilities: ["ricerca annunci di privati con telefono disponibile", "ricerca separata di professionisti", "classificazione tramite clientTypeID ufficiale", "incrocio con notifiche email per eliminare i duplicati"],
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
    const token = await getInsightsToken(baseUrl, settings);
    const privateCandidates = new Map<string, Record<string, any>>();
    const professionalCandidates = new Map<string, Record<string, any>>();
    let resultsRead = 0;
    let detailRead = 0;
    let detailsFailed = 0;
    let privatePagesRead = 0;
    let professionalPagesRead = 0;
    let professionalLookupAvailable = true;
    let professionalLookupStatus: number | null = null;
    const maxPages = 10;

    // Due ricerche separate sul medesimo dataset ufficiale:
    // 1 = proprietari privati con numero telefonico disponibile;
    // 2 = professionisti, senza filtro sul telefono, per riconoscere anche le email già raccolte.
    for (const clientTypeID of [1, 2] as const) {
      const target = clientTypeID === 1 ? privateCandidates : professionalCandidates;
      const phoneFilter = clientTypeID === 1 ? true : null;

      for (let page = 1; page <= maxPages; page++) {
        const response = await fetch(baseUrl + "/comparables/searchByAttribute", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(buildInsightsSearchPayload(new Date(), lookbackDays, page, clientTypeID, phoneFilter)),
          signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
          console.error("Immobiliare Insights search failed for clientTypeID " + clientTypeID + ":", response.status);
          if (clientTypeID === 1) {
            throw new Error("Ricerca ufficiale dei proprietari privati non riuscita. Verificare che l'account abiliti Comps Finder e il filtro clientTypeID.");
          }
          professionalLookupAvailable = false;
          professionalLookupStatus = response.status;
          break;
        }

        const result = await response.json();
        const items = Array.isArray(result.items) ? result.items : [];
        resultsRead += items.length;
        if (clientTypeID === 1) privatePagesRead++;
        else professionalPagesRead++;

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
            const candidate = toCandidate(detail, userData.user.id, clientTypeID);
            const key = candidate ? canonicalImmobiliareUrl(candidate.url) : null;
            if (candidate && key) target.set(key, candidate);
          }
        }

        const lastPage = Number(result?._metadata?.pages?.last || page);
        if (page >= lastPage || items.length === 0) break;
      }
      if (clientTypeID === 2 && !professionalLookupAvailable) break;
    }

    // Legge le opportunità già arrivate via email per classificare lo stesso annuncio
    // senza creare duplicati fra la fonte Gmail e la fonte API.
    const existingRows: Array<Record<string, any>> = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data: page, error } = await supabase
        .from("annunci_candidati")
        .select("id,url,url_originale,stato,seller_manual_override")
        .eq("owner_id", userData.user.id)
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error("Lettura dei candidati già raccolti non riuscita.");
      existingRows.push(...(page || []));
      if (!page || page.length < pageSize) break;
    }

    const existingByUrl = new Map<string, Record<string, any>[]>();
    for (const row of existingRows) {
      const key = canonicalImmobiliareUrl(row.url) || canonicalImmobiliareUrl(row.url_originale);
      if (!key) continue;
      const group = existingByUrl.get(key) || [];
      group.push(row);
      existingByUrl.set(key, group);
    }

    const privateUpdateIds: string[] = [];
    const professionalUpdateIds: string[] = [];
    const rowsToInsert = new Map<string, Record<string, any>>();
    let protectedManual = 0;
    let conflictingProviderTypes = 0;

    const allProviderUrls = new Set([
      ...privateCandidates.keys(),
      ...professionalCandidates.keys()
    ]);

    for (const key of allProviderUrls) {
      const privateCandidate = privateCandidates.get(key);
      const professionalCandidate = professionalCandidates.get(key);
      // Se il provider restituisce lo stesso URL nei due gruppi, non scegliamo a caso.
      if (privateCandidate && professionalCandidate) {
        conflictingProviderTypes++;
        continue;
      }

      const matches = existingByUrl.get(key) || [];
      const activeRows = matches.filter(row =>
        row.stato === "da_verificare" && row.seller_manual_override !== true
      );
      protectedManual += matches.filter(row => row.seller_manual_override === true).length;

      if (privateCandidate) {
        if (activeRows.length) {
          privateUpdateIds.push(...activeRows.map(row => String(row.id)));
        } else if (matches.length === 0) {
          rowsToInsert.set(privateCandidate.dedup_key, privateCandidate);
        }
      } else if (professionalCandidate && activeRows.length) {
        professionalUpdateIds.push(...activeRows.map(row => String(row.id)));
      }
    }

    const nowIso = new Date().toISOString();
    let matchedEmailAsPrivate = 0;
    let matchedEmailAsProfessional = 0;

    if (privateUpdateIds.length) {
      const { data, error } = await supabase
        .from("annunci_candidati")
        .update({
          tipo_venditore: "Privato",
          seller_confidence: 99,
          seller_evidence: "Immobiliare.it Insights: corrispondenza URL con filtro ufficiale clientTypeID=1 (Privato)",
          seller_classification_version: 4,
          seller_manual_override: false,
          updated_at: nowIso
        })
        .eq("owner_id", userData.user.id)
        .eq("stato", "da_verificare")
        .eq("seller_manual_override", false)
        .in("id", [...new Set(privateUpdateIds)])
        .select("id");
      if (error) throw new Error("Aggiornamento dei venditori privati riconosciuti non riuscito.");
      matchedEmailAsPrivate = data?.length ?? 0;
    }

    if (professionalUpdateIds.length) {
      const { data, error } = await supabase
        .from("annunci_candidati")
        .update({
          tipo_venditore: "Agenzia",
          seller_confidence: 99,
          seller_evidence: "Immobiliare.it Insights: corrispondenza URL con filtro ufficiale clientTypeID=2 (Professionista)",
          seller_classification_version: 4,
          seller_manual_override: false,
          stato: "scartato",
          updated_at: nowIso
        })
        .eq("owner_id", userData.user.id)
        .eq("stato", "da_verificare")
        .eq("seller_manual_override", false)
        .in("id", [...new Set(professionalUpdateIds)])
        .select("id");
      if (error) throw new Error("Esclusione degli annunci pubblicati da professionisti non riuscita.");
      matchedEmailAsProfessional = data?.length ?? 0;
    }

    const rows = [...rowsToInsert.values()];
    let inserted = 0;
    if (rows.length) {
      const { data, error } = await supabase
        .from("annunci_candidati")
        .upsert(rows, { onConflict: "owner_id,dedup_key", ignoreDuplicates: true })
        .select("id");
      if (error) {
        console.error("Immobiliare Insights candidate save failed:", error.message);
        throw new Error("Risultati ricevuti, ma non è stato possibile salvare i nuovi proprietari privati.");
      }
      inserted = data?.length ?? 0;
    }

    return reply({
      success: true,
      provider: "Immobiliare.it Insights",
      environment,
      lookbackDays,
      pagesRead: privatePagesRead + professionalPagesRead,
      privatePagesRead,
      professionalPagesRead,
      resultsRead,
      detailRead,
      detailsFailed,
      privateCandidatesMatched: privateCandidates.size,
      professionalCandidatesMatched: professionalCandidates.size,
      matchedEmailAsPrivate,
      matchedEmailAsProfessional,
      conflictingProviderTypes,
      protectedManual,
      professionalLookupAvailable,
      professionalLookupStatus,
      inserted,
      alreadyPresent: Math.max(0, privateCandidates.size - inserted - matchedEmailAsPrivate),
      note: "Gli annunci delle email sono confrontati con due ricerche ufficiali: clientTypeID=1 (Privato) e clientTypeID=2 (Professionista). Le verifiche manuali e gli annunci già scartati non vengono sovrascritti. Il numero telefonico non è restituito dal mapping API documentato: il link dell'annuncio resta il canale di contatto."
    });
  } catch (error) {
    console.error("Immobiliare Insights sync error:", error instanceof Error ? error.message : "unknown error");
    return reply({
      success: false,
      error: error instanceof Error ? error.message : "Errore durante la ricerca API."
    }, 502);
  }
});
