import { withSupabase } from "npm:@supabase/server@^1";

const GOOGLE_REDIRECT_URI =
  "https://hhircfmrtkgaybrougku.supabase.co/functions/v1/nmre-gmail-oauth-callback";

export default {
  fetch: withSupabase(
    { auth: "user" },
    async (req, ctx) => {
      if (req.method !== "POST") {
        return Response.json(
          { error: "Metodo non consentito" },
          { status: 405 }
        );
      }

      try {
        const allowedUserId = Deno.env.get(
          "NMRE_ALLOWED_USER_ID"
        );

        const userId = ctx.userClaims?.id;

        if (!allowedUserId || !userId) {
          return Response.json(
            { error: "Configurazione o autenticazione mancante" },
            { status: 403 }
          );
        }

        if (userId.toLowerCase() !== allowedUserId.toLowerCase()) {
          return Response.json(
            { error: "Utente non autorizzato" },
            { status: 403 }
          );
        }

        const clientId = Deno.env.get("GOOGLE_CLIENT_ID");

        if (!clientId) {
          throw new Error("Google Client ID mancante");
        }

        const randomBytes = crypto.getRandomValues(
          new Uint8Array(32)
        );

        const state = btoa(
          String.fromCharCode(...randomBytes)
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const expiresAt = new Date(
          Date.now() + 10 * 60 * 1000
        ).toISOString();

        const { error: stateError } =
          await ctx.supabaseAdmin.rpc(
            "nmre_save_oauth_state",
            {
              p_state: state,
              p_user_id: userId,
              p_expires_at: expiresAt,
            }
          );

        if (stateError) {
          console.error(
            "Errore salvataggio stato OAuth:",
            stateError
          );

          throw new Error(
            "Impossibile creare lo stato OAuth"
          );
        }

        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: GOOGLE_REDIRECT_URI,
          response_type: "code",
          scope:
            "openid email https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
          state,
        });

        return Response.json({
          authorization_url:
            `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        });

      } catch (error) {
        console.error("Errore OAuth start:", error);

        return Response.json(
          {
            error:
              "Impossibile avviare il collegamento Gmail",
          },
          { status: 500 }
        );
      }
    }
  ),
};