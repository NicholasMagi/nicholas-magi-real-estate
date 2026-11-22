import { withSupabase } from "npm:@supabase/server@^1";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json(
        { error: "Metodo non consentito" },
        { status: 405 }
      );
    }

    const allowedUserId = Deno.env.get("NMRE_ALLOWED_USER_ID");
    const userId = ctx.userClaims?.id;

    if (!allowedUserId || !userId ||
        userId.toLowerCase() !== allowedUserId.toLowerCase()) {
      return Response.json(
        { error: "Utente non autorizzato" },
        { status: 403 }
      );
    }

    return Response.json(
      {
        success: false,
        disabled: true,
        message: "La lettura diretta delle email è stata dismessa. La casella viene elaborata in background; gli annunci estratti sono disponibili nella sezione candidati."
      },
      { status: 410 }
    );
  })
};
