import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "https://nicholasmagi.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });

function getServiceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default || Object.values(keys)[0] as string || "";
  } catch { return ""; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  if (req.method === "GET") return json({ publicKey, configured: !!publicKey });

  const serviceKey = getServiceKey();
  const authHeader = req.headers.get("Authorization") || "";
  const apiKey = req.headers.get("apikey") || "";
  const body = await req.json().catch(() => ({}));
  const isWebhook = !!serviceKey && (authHeader === `Bearer ${serviceKey}` || apiKey === serviceKey);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let notificationId = body?.record?.id || body?.notification_id || null;
  let ownerId: string | null = null;

  if (!isWebhook) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Autenticazione richiesta" }, 401);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Sessione non valida" }, 401);
    ownerId = userData.user.id;

    if (body?.action === "test") {
      const { error: insertError } = await admin.from("nmre_notifications").insert({
        owner_id: ownerId,
        category: "new_opportunities",
        title: "Notifiche NMRE attive",
        body: "Questo è un messaggio di prova: il collegamento push è operativo.",
        target_url: "/"
      });
      if (insertError) return json({ error: insertError.message }, 500);
      return json({ success: true, created: true, message: "Notifica di prova creata; il trigger del database avvia l'invio push." });
    } else {
      return json({ error: "Azione non supportata" }, 400);
    }
  } else if (!notificationId) {
    return json({ error: "ID notifica mancante" }, 400);
  }

  const { data: notification, error: notificationError } = await admin
    .from("nmre_notifications").select("*").eq("id", notificationId).maybeSingle();
  if (notificationError || !notification) return json({ error: "Notifica non trovata" }, 404);
  ownerId = notification.owner_id;

  const { data: preferences } = await admin.from("nmre_notification_preferences")
    .select("enabled,categories,quiet_hours_enabled,quiet_hours_start,quiet_hours_end")
    .eq("owner_id", ownerId).maybeSingle();
  const enabled = preferences?.enabled !== false && preferences?.categories?.[notification.category] !== false;
  if (!enabled) return json({ skipped: "Notifiche disattivate nelle preferenze" });

  // NMRE operates in Italy: apply quiet hours in the Europe/Rome timezone,
  // including the daylight-saving-time change automatically.
  if (preferences?.quiet_hours_enabled === true && preferences.quiet_hours_start && preferences.quiet_hours_end) {
    const start = String(preferences.quiet_hours_start).slice(0, 5);
    const end = String(preferences.quiet_hours_end).slice(0, 5);
    if (start !== end) {
      const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Rome",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).format(new Date()).split(":").map(Number);
      const nowMinutes = hour * 60 + minute;
      const [startHour, startMinute] = start.split(":").map(Number);
      const [endHour, endMinute] = end.split(":").map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;
      const inQuietHours = startMinutes < endMinutes
        ? nowMinutes >= startMinutes && nowMinutes < endMinutes
        : nowMinutes >= startMinutes || nowMinutes < endMinutes;
      if (inQuietHours) return json({ skipped: "Fascia di silenzio attiva", timezone: "Europe/Rome" });
    }
  }

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (!vapidPublic || !vapidPrivate) return json({ error: "Chiavi VAPID non configurate" }, 503);

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  const { data: subscriptions, error: subError } = await admin.from("nmre_push_subscriptions")
    .select("id,endpoint,p256dh,auth_secret").eq("owner_id", ownerId);
  if (subError) return json({ error: subError.message }, 500);

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.target_url || "/",
    notificationId: notification.id
  });
  let sent = 0;
  const failures: string[] = [];
  for (const sub of subscriptions || []) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_secret }
      }, payload, { TTL: 60 * 60, urgency: "high" });
      sent++;
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await admin.from("nmre_push_subscriptions").delete().eq("id", sub.id);
      } else {
        failures.push(String((error as Error)?.message || error).slice(0, 300));
      }
    }
  }
  await admin.from("nmre_notifications").update({
    push_sent_at: sent ? new Date().toISOString() : null,
    push_error: failures.length ? failures.join("; ").slice(0, 1000) : null
  }).eq("id", notificationId);
  return json({ success: true, sent, subscriptions: subscriptions?.length || 0, failures: failures.length });
});
