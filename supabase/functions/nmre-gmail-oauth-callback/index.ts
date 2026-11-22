import { withSupabase } from "npm:@supabase/server@^1";

const REDIRECT_URI =
  "https://hhircfmrtkgaybrougku.supabase.co/functions/v1/nmre-gmail-oauth-callback";

const APP_URL =
  "https://nicholasmagi.github.io/nicholas-magi-real-estate/";

const EXPECTED_GMAIL = "nicholasmagirealestate@gmail.com";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function unbase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) =>
    c.charCodeAt(0)
  );
}

async function getEncryptionKey(
  secret: string
): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );

  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptTokens(
  tokens: Record<string, unknown>,
  secret: string
): Promise<string> {
  const key = await getEncryptionKey(secret);
  const iv = crypto.getRandomValues(
    new Uint8Array(12)
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(tokens))
  );

  return `v1.${base64(iv)}.${base64(
    new Uint8Array(encrypted)
  )}`;
}

async function decryptTokens(
  value: string,
  secret: string
): Promise<Record<string, unknown>> {
  const parts = value.split(".");

  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Formato token cifrato non valido");
  }

  const key = await getEncryptionKey(secret);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64(parts[1]),
    },
    key,
    unbase64(parts[2])
  );

  return JSON.parse(
    new TextDecoder().decode(decrypted)
  );
}

function page(
  message: string,
  status = 200
): Response {
  const html = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Collegamento Gmail</title>
</head>
<body style="font-family:Arial,sans-serif;padding:35px;max-width:550px;margin:auto">
  <h2>${message}</h2>
  <p>Può tornare a Nicholas Magi Real Estate.</p>
  <a href="${APP_URL}">Apri l'applicazione</a>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  fetch: withSupabase(
    { auth: "none" },
    async (req, ctx) => {
      if (req.method !== "GET") {
        return page("Metodo non consentito", 405);
      }

      try {
        const url = new URL(req.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const googleError = url.searchParams.get("error");

        const allowedUserId = Deno.env.get(
          "NMRE_ALLOWED_USER_ID"
        );

        if (
          !allowedUserId ||
          !/^[0-9a-f-]{36}$/i.test(allowedUserId)
        ) {
          throw new Error(
            "Configurazione utente autorizzato non valida"
          );
        }

        if (
          !state ||
          state.length < 32 ||
          state.length > 200
        ) {
          return page(
            "Richiesta di autorizzazione non valida.",
            400
          );
        }

        const { data: validState, error: stateError } =
          await ctx.supabaseAdmin.rpc(
            "nmre_consume_oauth_state",
            {
              p_state: state,
              p_user_id: allowedUserId,
            }
          );

        if (stateError || validState !== true) {
          return page(
            "Autorizzazione scaduta o non valida.",
            400
          );
        }

        if (googleError) {
          return page(
            "Il collegamento Gmail è stato annullato.",
            400
          );
        }

        if (!code) {
          return page(
            "Codice di autorizzazione mancante.",
            400
          );
        }

        const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
        const clientSecret = Deno.env.get(
          "GOOGLE_CLIENT_SECRET"
        );
        const encryptionSecret = Deno.env.get(
          "INTEGRATION_TOKEN_ENCRYPTION_KEY"
        );

        if (
          !clientId ||
          !clientSecret ||
          !encryptionSecret
        ) {
          throw new Error(
            "Configurazione server incompleta"
          );
        }

        const tokenResponse = await fetch(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: REDIRECT_URI,
              grant_type: "authorization_code",
            }),
          }
        );

        if (!tokenResponse.ok) {
          throw new Error(
            "Scambio del codice Google non riuscito"
          );
        }

        const newTokens = await tokenResponse.json();

        if (!newTokens.access_token) {
          throw new Error(
            "Token di accesso mancante"
          );
        }

        const userResponse = await fetch(
          "https://openidconnect.googleapis.com/v1/userinfo",
          {
            headers: {
              Authorization:
                `Bearer ${newTokens.access_token}`,
            },
          }
        );

        if (!userResponse.ok) {
          throw new Error(
            "Verifica account Google non riuscita"
          );
        }

        const user = await userResponse.json();

        if (
          !user.email ||
          user.email_verified !== true ||
          user.email.toLowerCase() !== EXPECTED_GMAIL
        ) {
          throw new Error(
            "L'account Google non corrisponde alla casella autorizzata"
          );
        }

        const { data: oldRows, error: oldError } =
          await ctx.supabaseAdmin.rpc(
            "nmre_get_gmail_tokens"
          );

        if (oldError) {
          throw new Error(
            "Impossibile recuperare i token precedenti"
          );
        }

        let previousTokens: Record<string, unknown> = {};

        if (oldRows?.[0]?.token_ciphertext) {
          previousTokens = await decryptTokens(
            oldRows[0].token_ciphertext,
            encryptionSecret
          );
        }

        const refreshToken =
          newTokens.refresh_token ||
          previousTokens.refresh_token;

        if (!refreshToken) {
          throw new Error(
            "Refresh token non disponibile: occorre una nuova autorizzazione Google"
          );
        }

        const expiresAt = new Date(
          Date.now() +
          Number(newTokens.expires_in || 3600) * 1000
        ).toISOString();

        const encryptedTokens = await encryptTokens(
          {
            access_token: newTokens.access_token,
            refresh_token: refreshToken,
            token_type: newTokens.token_type || "Bearer",
            scope: newTokens.scope || "",
          },
          encryptionSecret
        );

        const { error: saveError } =
          await ctx.supabaseAdmin.rpc(
            "nmre_save_gmail_tokens",
            {
              p_email: user.email,
              p_token_ciphertext: encryptedTokens,
              p_scope: newTokens.scope || "",
              p_expires_at: expiresAt,
            }
          );

        if (saveError) {
          throw new Error(
            "Salvataggio dei token non riuscito"
          );
        }

        return page("Gmail collegato correttamente!");
      } catch (error) {
        console.error(
          "Errore durante il collegamento OAuth Gmail:",
          error instanceof Error
            ? error.message
            : "Errore sconosciuto"
        );

        return page(
          "Non è stato possibile completare il collegamento Gmail.",
          500
        );
      }
    }
  ),
};