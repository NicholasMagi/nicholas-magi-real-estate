// nmre-gmail-push · Callback autenticato di Google Pub/Sub per le notifiche Gmail.
// Verify JWT della piattaforma disattivato (Pub/Sub invia un token OIDC Google, non un
// JWT Supabase): l'autenticazione è tutta qui e in handler.ts. Verifiche OIDC: firma con
// le chiavi pubbliche Google, issuer Google, audience = GMAIL_PUBSUB_AUDIENCE, algoritmo
// RS256; poi service account, email verificata e subscription obbligatoria (handler.ts).
import { createRemoteJWKSet, jwtVerify } from "npm:jose@^5.9.6";
import { withSupabase } from "npm:@supabase/server@^1";
import { handlePushRequest } from "./handler.ts";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

export default {
  fetch: withSupabase({ auth: "none" }, (req, ctx) =>
    handlePushRequest(req, {
      env: name => Deno.env.get(name),
      verifyOidc: async (token, audience) => {
        const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience,
          algorithms: ["RS256"]
        });
        return payload;
      },
      startSync: historyId => ctx.supabaseAdmin.functions.invoke(
        "nmre-gmail-scheduled",
        { body: { trigger: "gmail-pubsub", historyId } }
      ),
      log: (message, detail) => detail === undefined ? console.error(message) : console.error(message + ":", detail)
    })
  )
};
