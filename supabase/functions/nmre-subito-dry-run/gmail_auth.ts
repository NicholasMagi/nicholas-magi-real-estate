// Token Gmail per la prova senza scritture. Stessa cifratura di nmre-gmail-scheduled
// (AES-GCM, formato "v1.<iv>.<cipher>"), con UNA differenza voluta: se il token di
// accesso è scaduto viene rinnovato solo in memoria. Il nuovo token NON viene salvato
// (nessuna chiamata a nmre_save_gmail_tokens): il refresh token resta quello salvato e
// la sincronizzazione programmata continua a usare e rinnovare i propri token.

function unb64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
}

export async function decryptTokens(value: string, secret: string): Promise<Record<string, unknown>> {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Formato token cifrato non valido");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(parts[1]) }, await encryptionKey(secret), unb64(parts[2]));
  return JSON.parse(new TextDecoder().decode(plain));
}

export type TokenFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Token di accesso valido, rinnovato solo in memoria se scaduto. Non scrive nulla. */
export async function accessTokenInMemory(
  tokens: Record<string, unknown>,
  expiresAt: string,
  env: { clientId?: string; clientSecret?: string },
  fetcher: TokenFetch,
  nowMs = Date.now()
): Promise<{ token: string; refreshedInMemory: boolean }> {
  if (new Date(expiresAt).getTime() > nowMs + 60000 && typeof tokens.access_token === "string" && tokens.access_token) {
    return { token: tokens.access_token, refreshedInMemory: false };
  }
  const refresh = tokens.refresh_token;
  if (typeof refresh !== "string" || !refresh) throw new Error("Refresh token non disponibile");
  if (!env.clientId || !env.clientSecret) throw new Error("Configurazione Google incompleta");
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, refresh_token: refresh, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error("Rinnovo del token Google non riuscito (" + response.status + ")");
  const fresh = await response.json();
  if (typeof fresh.access_token !== "string" || !fresh.access_token) throw new Error("Token Google mancante");
  return { token: fresh.access_token, refreshedInMemory: true };
}
