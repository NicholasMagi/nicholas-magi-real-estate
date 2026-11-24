import { createRemoteJWKSet, jwtVerify } from "npm:jose@^5.9.6";
import { withSupabase } from "npm:@supabase/server@^1";

const ACCOUNT = "nicholasmagirealestate@gmail.com";
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

function decodePubSubData(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Metodo non consentito" }, { status: 405 });
    }

    const audience = Deno.env.get("GMAIL_PUBSUB_AUDIENCE");
    const expectedServiceAccount = Deno.env.get("GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL");
    const expectedSubscription = Deno.env.get("GMAIL_PUBSUB_SUBSCRIPTION");

    if (!audience || !expectedServiceAccount) {
      return Response.json({ error: "Configurazione Gmail Push incompleta" }, { status: 503 });
    }

    const authorization = req.headers.get("authorization") || "";
    const bearer = authorization.match(/^Bearer\\s+(.+)$/i)?.[1];
    if (!bearer) {
      return Response.json({ error: "Token OIDC Pub/Sub mancante" }, { status: 401 });
    }

    try {
      const { payload } = await jwtVerify(bearer, GOOGLE_JWKS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience,
        algorithms: ["RS256"]
      });

      if (
        payload.email !== expectedServiceAccount ||
        (payload.email_verified !== true && payload.email_verified !== "true")
      ) {
        return Response.json({ error: "Identità Pub/Sub non autorizzata" }, { status: 403 });
      }

      const envelope = await req.json();
      if (
        expectedSubscription &&
        envelope.subscription !== expectedSubscription
      ) {
        return Response.json({ error: "Subscription Pub/Sub non autorizzata" }, { status: 403 });
      }

      const encoded = envelope?.message?.data;
      if (typeof encoded !== "string" || !encoded) {
        return Response.json({ error: "Messaggio Pub/Sub non valido" }, { status: 400 });
      }

      const notification = decodePubSubData(encoded) as Record<string, unknown>;
      const emailAddress = String(notification.emailAddress || "").toLowerCase();
      const historyId = String(notification.historyId || "");

      if (emailAddress !== ACCOUNT) {
        return new Response(null, { status: 204 });
      }
      if (!/^[0-9]{1,30}$/.test(historyId)) {
        return Response.json({ error: "Cronologia Gmail non valida" }, { status: 400 });
      }

      const { data, error } = await ctx.supabaseAdmin.functions.invoke(
        "nmre-gmail-scheduled",
        { body: { trigger: "gmail-pubsub", historyId } }
      );

      if (error) {
        console.error("Avvio sincronizzazione Gmail da Pub/Sub non riuscito:", error.message);
        return Response.json({ error: "Sincronizzazione Gmail non disponibile" }, { status: 503 });
      }

      return Response.json({
        success: true,
        historyId,
        skipped: data?.skipped || null
      });
    } catch (error) {
      console.error(
        "Notifica Gmail Pub/Sub non valida o non elaborata:",
        error instanceof Error ? error.message : "Errore sconosciuto"
      );
      return Response.json({ error: "Notifica Gmail Push non valida" }, { status: 401 });
    }
  })
};
