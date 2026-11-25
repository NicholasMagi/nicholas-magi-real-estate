import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://nicholasmagi.github.io",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const LISTING_PORTALS = [
  "immobiliare.it", "idealista.it", "casa.it", "subito.it",
  "green-acres.it", "green-acres.com", "gate-away.com",
  "trovacasa.it", "wikicasa.it"
];

function canonicalListingKey(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\\./, "");
    const allowed = LISTING_PORTALS.some(domain => host === domain || host.endsWith("." + domain));
    if (!allowed) return null;
    const path = decodeURIComponent(url.pathname).replace(/\\/+$/, "").toLowerCase() || "/";
    if (path === "/" || /\\/(?:search|ricerca|risultati|vendita|affitto|case-in-vendita|immobili-in-vendita)(?:\\/|$)/.test(path)) return null;
    const isSpecific = host === "immobiliare.it" || host.endsWith(".immobiliare.it")
      ? /\\/(?:annunci|immobile)\\/[^/]*\\d{5,}/i.test(path)
      : /\\/(?:annuncio|annunci|immobile|immobili|property|listing|detail)\\/[^/]+/i.test(path)
        || /\\/[^/]*\\d{6,}[^/]*(?:\\.html?)?\\/?$/i.test(path);
    return isSpecific ? host + path : null;
  } catch {
    return null;
  }
}

function safeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    if (JSON.stringify(value).length > 100_000) return null;
  } catch {
    return null;
  }
  return value as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return reply({
      success: true,
      app: "Nicholas Magi Real Estate",
      status: "online",
      message: "Servizio pronto a ricevere annunci autenticati.",
    });
  }

  if (req.method !== "POST") {
    return reply({ success: false, error: "Metodo non consentito." }, 405);
  }

  try {
    const authorization = req.headers.get("Authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return reply({ success: false, error: "Autenticazione richiesta." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("Configurazione Supabase mancante.");
      return reply({ success: false, error: "Configurazione non disponibile." }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authorization } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return reply({ success: false, error: "Sessione non valida." }, 401);
    }

    const body = await req.json();

    const titolo = typeof body.titolo === "string" ? body.titolo.trim() : "";
    const comune = typeof body.comune === "string" ? body.comune.trim() : "";

    if (!titolo || !comune) {
      return reply({
        success: false,
        error: "Titolo e comune sono obbligatori.",
      }, 400);
    }

    let prezzo: number | null = null;

    if (body.prezzo !== undefined && body.prezzo !== null && body.prezzo !== "") {
      prezzo = Number(body.prezzo);

      if (!Number.isFinite(prezzo) || prezzo < 0) {
        return reply({ success: false, error: "Prezzo non valido." }, 400);
      }
    }

    const optionalText = (value: unknown) =>
      typeof value === "string" ? value.trim().slice(0, 1000) : null;
    const optionalNumber = (value: unknown): number | null => {
      if (value === undefined || value === null || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const surface = optionalNumber(body.superficie_mq);
    const rooms = optionalNumber(body.locali);
    const bedrooms = optionalNumber(body.camere);
    const bathrooms = optionalNumber(body.bagni);
    if (surface !== null && (!Number.isInteger(surface) || surface < 1 || surface > 100000)) {
      return reply({ success: false, error: "Superficie non valida." }, 400);
    }
    if (rooms !== null && (rooms < 0.5 || rooms > 100)) {
      return reply({ success: false, error: "Numero locali non valido." }, 400);
    }
    if (bedrooms !== null && (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 100)) {
      return reply({ success: false, error: "Numero camere non valido." }, 400);
    }
    if (bathrooms !== null && (!Number.isInteger(bathrooms) || bathrooms < 0 || bathrooms > 100)) {
      return reply({ success: false, error: "Numero bagni non valido." }, 400);
    }

    const optionalUrl = (value: unknown) =>
      typeof value === "string" ? value.trim().slice(0, 2000) : null;
    const url = optionalUrl(body.url);
    const originalUrl = optionalUrl(body.url_originale) ?? url;
    const listingKey = canonicalListingKey(originalUrl ?? url);
    const sellerType = optionalText(body.tipo_venditore) ?? "Da verificare";
    if (!["Privato", "Agenzia", "Da verificare"].includes(sellerType)) {
      return reply({ success: false, error: "Tipologia venditore non valida." }, 400);
    }

    // Duplicate checks are owner-scoped and backed by the unique listing_key index.
    if (listingKey) {
      const { data: existing, error: duplicateError } = await supabase
        .from("annunci")
        .select("id,titolo")
        .eq("owner_id", userData.user.id)
        .eq("listing_key", listingKey)
        .limit(1)
        .maybeSingle();
      if (duplicateError) return reply({ success: false, error: "Controllo duplicati non riuscito." }, 400);
      if (existing) return reply({ success: false, duplicate: true, error: "Questo annuncio è già presente nell’Archivio." });
    }
    for (const candidateUrl of [...new Set([url, originalUrl].filter((value): value is string => !!value))]) {
      for (const column of ["url", "url_originale"] as const) {
        const { data: existing, error: duplicateError } = await supabase
          .from("annunci")
          .select("id,titolo")
          .eq("owner_id", userData.user.id)
          .eq(column, candidateUrl)
          .limit(1)
          .maybeSingle();
        if (duplicateError) return reply({ success: false, error: "Controllo duplicati non riuscito." }, 400);
        if (existing) return reply({ success: false, duplicate: true, error: "Questo annuncio è già presente nell’Archivio." });
      }
    }

    const sourceData = safeObject(body.dati_fonte);
    const extractedData = safeObject(body.dati_estratti);
    const extractionVersion = Number(body.data_extraction_version);
    const { data: annuncio, error: insertError } = await supabase
      .from("annunci")
      .insert({
        owner_id: userData.user.id,
        titolo: titolo.slice(0, 250),
        comune: comune.slice(0, 150),
        indirizzo: optionalText(body.indirizzo)?.slice(0, 220) ?? null,
        prezzo,
        contatto: optionalText(body.contatto),
        tipo_venditore: sellerType,
        seller_identity: optionalText(body.seller_identity),
        portale: optionalText(body.portale),
        url,
        url_originale: originalUrl,
        listing_key: listingKey,
        tipologia_immobile: optionalText(body.tipologia_immobile)?.slice(0, 80) ?? null,
        superficie_mq: surface,
        locali: rooms,
        camere: bedrooms,
        bagni: bathrooms,
        dati_fonte: sourceData,
        dati_estratti: extractedData,
        data_extraction_version: Number.isInteger(extractionVersion) && extractionVersion >= 1 && extractionVersion <= 10
          ? extractionVersion
          : 1,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return reply({ success: false, duplicate: true, error: "Questo annuncio è già presente nell’Archivio." });
      }
      console.error("Errore salvataggio annuncio:", insertError.message);
      return reply({ success: false, error: "Impossibile salvare l'annuncio." }, 400);
    }

    return reply({
      success: true,
      message: "Annuncio salvato correttamente.",
      annuncio,
    }, 201);

  } catch (error) {
    console.error("Errore funzione:", error);
    return reply({ success: false, error: "Richiesta non valida." }, 400);
  }
});