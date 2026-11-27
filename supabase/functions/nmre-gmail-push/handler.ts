// Logica di nmre-gmail-push, separata da index.ts per poterla verificare nei test senza
// rete: ambiente, verifica OIDC, avvio della sincronizzazione e log sono iniettati.
//
// Ordine dei controlli:
//  1. solo POST (405);
//  2. configurazione completa e subscription nel formato atteso (503);
//  3. token OIDC presente (401) e verificato da Google: firma, issuer, audience (401);
//  4. identità: service account atteso con email verificata (403);
//  5. busta Pub/Sub: subscription identica a GMAIL_PUBSUB_SUBSCRIPTION (403);
//  6. messaggio: casella e historyId validi, poi avvio di nmre-gmail-scheduled.
// Nei log: mai valori di secret, token, busta o messaggio; solo nomi dei secret ed esiti.
import { readPushConfig, subscriptionMatches } from "./config.ts";
import type { PushSecretName } from "./config.ts";

const ACCOUNT = "nicholasmagirealestate@gmail.com";

export type OidcPayload = { email?: unknown; email_verified?: unknown; [claim: string]: unknown };

export type PushDeps = {
  env(name: PushSecretName): string | undefined;
  /** Verifica firma, issuer, audience e algoritmo del token OIDC; solleva un errore se non valido. */
  verifyOidc(token: string, audience: string): Promise<OidcPayload>;
  startSync(historyId: string): Promise<{ data?: { skipped?: unknown } | null; error?: { message?: string } | null }>;
  log(message: string, detail?: string): void;
};

function decodePubSubData(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function handlePushRequest(req: Request, deps: PushDeps): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Metodo non consentito" }, { status: 405 });
  }

  const configuration = readPushConfig(name => deps.env(name));
  if (!configuration.ok) {
    // Solo i nomi dei secret mancanti o non validi, mai i valori.
    deps.log("Configurazione Gmail Push incompleta o non valida", [
      configuration.missing.length ? "mancanti: " + configuration.missing.join(", ") : "",
      configuration.invalid.length ? "formato non valido: " + configuration.invalid.join(", ") : ""
    ].filter(Boolean).join("; "));
    return Response.json({ error: "Configurazione Gmail Push incompleta" }, { status: 503 });
  }
  const { audience, serviceAccount, subscription } = configuration.config;

  const authorization = req.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) {
    return Response.json({ error: "Token OIDC Pub/Sub mancante" }, { status: 401 });
  }

  try {
    const payload = await deps.verifyOidc(bearer, audience);

    if (
      payload.email !== serviceAccount ||
      (payload.email_verified !== true && payload.email_verified !== "true")
    ) {
      return Response.json({ error: "Identità Pub/Sub non autorizzata" }, { status: 403 });
    }

    const envelope = await req.json();
    if (!subscriptionMatches(envelope, subscription)) {
      deps.log("Subscription Pub/Sub non autorizzata: richiesta rifiutata");
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

    const { data, error } = await deps.startSync(historyId);

    if (error) {
      deps.log("Avvio sincronizzazione Gmail da Pub/Sub non riuscito", String(error.message || "").slice(0, 200));
      return Response.json({ error: "Sincronizzazione Gmail non disponibile" }, { status: 503 });
    }

    return Response.json({
      success: true,
      historyId,
      skipped: data?.skipped || null
    });
  } catch (error) {
    deps.log(
      "Notifica Gmail Pub/Sub non valida o non elaborata",
      error instanceof Error ? error.message.slice(0, 200) : "Errore sconosciuto"
    );
    return Response.json({ error: "Notifica Gmail Push non valida" }, { status: 401 });
  }
}
