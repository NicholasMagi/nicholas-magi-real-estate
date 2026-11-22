import { withSupabase } from "npm:@supabase/server@^1";
import { parseListingEmail, type GmailApiMessage } from "../_shared/listing-email-parser.ts";

const EXPECTED_GMAIL = "nicholasmagirealestate@gmail.com";
const MAX_MESSAGES = 10;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function unbase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function getEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function decryptTokens(
  value: string,
  secret: string,
): Promise<Record<string, unknown>> {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Formato token cifrato non valido");
  }

  const key = await getEncryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unbase64(parts[1]) },
    key,
    unbase64(parts[2]),
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function encryptTokens(
  tokens: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const key = await getEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(tokens)),
  );
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}

async function getAccessToken(
  tokens: Record<string, unknown>,
  expiresAt: string,
  encryptionSecret: string,
  supabaseAdmin: any,
): Promise<string> {
  // Prima riutilizza l'access token valido: il refresh token serve solo
  // quando è necessario rinnovarlo.
  const expiration = new Date(expiresAt).getTime();
  if (
    Number.isFinite(expiration) &&
    expiration > Date.now() + 60_000 &&
    typeof tokens.access_token === "string" &&
    tokens.access_token
  ) {
    return tokens.access_token;
  }

  const refreshToken = tokens.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new Error("Refresh token non disponibile: ricolleghi Gmail");
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Configurazione Google incompleta");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    // Non registrare mai il body della risposta OAuth: potrebbe contenere dati sensibili.
    throw new Error("Rinnovo del token Google non riuscito");
  }

  const refreshed = await response.json();
  if (typeof refreshed.access_token !== "string" || !refreshed.access_token) {
    throw new Error("Nuovo token di accesso mancante");
  }

  const updatedTokens = {
    ...tokens,
    access_token: refreshed.access_token,
    token_type: refreshed.token_type || "Bearer",
    scope: refreshed.scope || tokens.scope || "",
    refresh_token: refreshToken,
  };

  const newExpiresAt = new Date(
    Date.now() + Number(refreshed.expires_in || 3600) * 1000,
  ).toISOString();

  const ciphertext = await encryptTokens(updatedTokens, encryptionSecret);
  const { error } = await supabaseAdmin.rpc("nmre_save_gmail_tokens", {
    p_email: EXPECTED_GMAIL,
    p_token_ciphertext: ciphertext,
    p_scope: String(updatedTokens.scope || ""),
    p_expires_at: newExpiresAt,
  });

  if (error) throw new Error("Aggiornamento token nel database non riuscito");
  return refreshed.access_token;
}

function getHeader(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

export default {
  fetch: withSupabase(
    { auth: "user" },
    async (req, ctx) => {
      if (req.method !== "POST") {
        return Response.json({ error: "Metodo non consentito" }, { status: 405 });
      }

      try {
        const allowedUserId = Deno.env.get("NMRE_ALLOWED_USER_ID");
        const userId = ctx.userClaims?.id;

        if (
          !allowedUserId ||
          !userId ||
          userId.toLowerCase() !== allowedUserId.toLowerCase()
        ) {
          return Response.json({ error: "Utente non autorizzato" }, { status: 403 });
        }

        const encryptionSecret = Deno.env.get("INTEGRATION_TOKEN_ENCRYPTION_KEY");
        if (!encryptionSecret) throw new Error("Chiave di cifratura mancante");

        const { data, error } = await ctx.supabaseAdmin.rpc("nmre_get_gmail_tokens");
        if (error || !data?.[0]?.token_ciphertext) {
          throw new Error("Collegamento Gmail non trovato");
        }

        const saved = data[0];
        if (saved.email?.toLowerCase() !== EXPECTED_GMAIL) {
          throw new Error("Casella Gmail non autorizzata");
        }

        const tokens = await decryptTokens(saved.token_ciphertext, encryptionSecret);
        const accessToken = await getAccessToken(
          tokens,
          saved.expires_at,
          encryptionSecret,
          ctx.supabaseAdmin,
        );

        const authHeaders = { Authorization: `Bearer ${accessToken}` };
        const listUrl = new URL(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        );
        listUrl.searchParams.set("maxResults", String(MAX_MESSAGES));
        listUrl.searchParams.set("q", "in:inbox newer_than:30d");

        const listResponse = await fetch(listUrl, { headers: authHeaders });
        if (!listResponse.ok) {
          throw new Error("Lettura della casella Gmail non riuscita");
        }

        const list = await listResponse.json();
        const messageRefs = (list.messages || []) as Array<{ id: string }>;

        const messages = await Promise.all(
          messageRefs.map(async (message) => {
            const detailUrl = new URL(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}`,
            );
            detailUrl.searchParams.set("format", "full");

            const response = await fetch(detailUrl, { headers: authHeaders });
            if (!response.ok) return null;

            const detail = await response.json();
            return detail as GmailApiMessage & {
              snippet?: string;
              payload?: GmailApiMessage["payload"];
            };
          }),
        );

        const validMessages = messages.filter(
          (message): message is NonNullable<typeof message> => message !== null,
        );

        const emails = validMessages.map((email) => ({
          id: email.id || "",
          from: getHeader(email.payload?.headers, "From"),
          subject: getHeader(email.payload?.headers, "Subject"),
          date: getHeader(email.payload?.headers, "Date"),
          snippet: (email.snippet || "").slice(0, 250),
        }));

        // Questi sono candidati preliminari, non annunci salvati.
        // L'utente dovrà verificare i campi prima di qualsiasi inserimento.
        const candidates = validMessages.map((email) => parseListingEmail(email));

        return Response.json({
          success: true,
          account: EXPECTED_GMAIL,
          total: emails.length,
          emails,
          candidates,
          candidateCount: candidates.length,
          savedAutomatically: 0,
          message: "Email lette e trasformate in candidati da verificare",
        });
      } catch (error) {
        console.error(
          "Errore Gmail reader:",
          error instanceof Error ? error.message : "Errore sconosciuto",
        );

        return Response.json(
          {
            success: false,
            error: error instanceof Error
              ? error.message
              : "Errore durante la lettura Gmail",
          },
          { status: 500 },
        );
      }
    },
  ),
};
