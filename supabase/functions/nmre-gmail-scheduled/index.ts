import {
  municipality,price,listingUrl,propertyEmail,listingTitle,propertyType,
  surface,rooms,bedrooms,bathrooms,resolveListingUrl,sellerClassificationDetails
} from "./_shared/parser.ts";
import { collectHistoryMessageIds } from "./_shared/history.ts";
import { withSupabase } from "npm:@supabase/server@^1";

const ACCOUNT = "nicholasmagirealestate@gmail.com";
const PORTALS = ["idealista.it","immobiliare.it","casa.it","subito.it","green-acres.it","green-acres.com","gate-away.com","trovacasa.it","wikicasa.it"];

type SellerRegistryEntry = {
  seller_type: "Privato" | "Agenzia";
  identifier_type: "identity" | "email" | "phone";
  identifier_normalized: string;
};

function normalizeSellerText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^\p{L}\p{N}@.+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function registrySellerMatch(
  text: string,
  registry: SellerRegistryEntry[]
): { classification: "Privato" | "Agenzia" | "Da verificare"; confidence: number; evidence: string } | null {
  const normalizedText = normalizeSellerText(text);
  const emails = new Set(
    (String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
      .map(value => value.toLowerCase())
  );
  const phones = new Set(
    (String(text).match(/\+?\d[\d\s().\/-]{7,}\d/g) || [])
      .map(value => value.replace(/\D/g, ""))
      .filter(value => value.length >= 9 && value.length <= 15)
  );

  const matches = registry.filter(entry => {
    if (!entry.identifier_normalized) return false;
    if (entry.identifier_type === "email") return emails.has(entry.identifier_normalized);
    if (entry.identifier_type === "phone") return phones.has(entry.identifier_normalized);
    if (entry.identifier_type === "identity") {
      const identifier = normalizeSellerText(entry.identifier_normalized);
      return identifier.length >= 5 && normalizedText.includes(identifier);
    }
    return false;
  });

  if (!matches.length) return null;
  const types = [...new Set(matches.map(entry => entry.seller_type))];
  if (types.length !== 1) {
    return {
      classification: "Da verificare",
      confidence: 0,
      evidence: "Identificativi presenti nel registro con classificazioni discordanti: verifica manuale necessaria"
    };
  }

  const classification = types[0];
  const sources = [...new Set(matches.map(entry =>
    entry.identifier_type === "phone" ? "telefono" :
    entry.identifier_type === "email" ? "email" : "identità registrata"
  ))];
  return {
    classification,
    confidence: 98,
    evidence: "Corrispondenza esatta con il registro dei venditori verificati NMRE (" + sources.join(", ") + ")"
  };
}

function classifySellerWithRegistry(
  text: string,
  registry: SellerRegistryEntry[]
): { classification: "Privato" | "Agenzia" | "Da verificare"; confidence: number; evidence: string } {
  const automatic = sellerClassificationDetails(text);
  const registered = registrySellerMatch(text, registry);
  if (!registered) return automatic;
  if (
    registered.classification !== "Da verificare" &&
    automatic.classification !== "Da verificare" &&
    registered.classification !== automatic.classification
  ) {
    return {
      classification: "Da verificare",
      confidence: 0,
      evidence: "Segnali discordanti tra annuncio e registro venditori: controllo manuale necessario"
    };
  }
  return registered;
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Metodo non consentito" }, { status: 405 });
    }

    const startedAt = new Date();
    let ownerForLog: string | null = null;
    let syncModeForLog: "full_initial" | "full_recovery" | "incremental" | null = null;

    try {
      const owner = Deno.env.get("NMRE_ALLOWED_USER_ID");
      ownerForLog = owner;
      const encryptionSecret = Deno.env.get("INTEGRATION_TOKEN_ENCRYPTION_KEY");
      if (!owner || !/^[0-9a-f-]{36}$/i.test(owner) || !encryptionSecret) {
        throw new Error("Configurazione server incompleta");
      }

      const { data, error } = await ctx.supabaseAdmin.rpc("nmre_get_gmail_tokens");
      if (error || !data?.[0]?.token_ciphertext) throw new Error("Collegamento Gmail non trovato");
      if (data[0].email?.toLowerCase() !== ACCOUNT) throw new Error("Casella Gmail non autorizzata");

      const tokens = await decrypt(data[0].token_ciphertext, encryptionSecret);
      const token = await accessToken(tokens, data[0].expires_at, encryptionSecret, ctx.supabaseAdmin);
      const profileHistoryId = await gmailProfile(token);
      const cursor = await readSyncCursor(ctx.supabaseAdmin);

      let messageIds: string[];
      let nextHistoryId = profileHistoryId;
      let syncMode: "full_initial" | "full_recovery" | "incremental";
      let historyRecords = 0;

      if (!cursor) {
        messageIds = await listFullSyncMessageIds(token);
        syncMode = "full_initial";
      } else {
        const history = await listHistoryMessageIds(token, cursor);
        if (history) {
          messageIds = history.ids;
          nextHistoryId = history.historyId;
          historyRecords = history.historyRecords;
          syncMode = "incremental";
        } else {
          messageIds = await listFullSyncMessageIds(token);
          syncMode = "full_recovery";
        }
      }
      syncModeForLog = syncMode;

      // Reprocess pending Immobiliare.it alerts whose saved URL was resolved to the
      // portal homepage instead of an individual listing.
      const { data: candidatesToRepair, error: repairQueryError } = await ctx.supabaseAdmin
        .from("annunci_candidati")
        .select("source_email_id,url,url_originale,seller_classification_version,seller_manual_override")
        .eq("owner_id", owner)
        .eq("stato", "da_verificare")
        .not("source_email_id", "is", null)
        .limit(200);

      if (repairQueryError) throw new Error("Lettura dei link da correggere non riuscita");
      const repairIds = (candidatesToRepair || [])
        .filter((candidate: any) => {
          if (typeof candidate.source_email_id !== "string" || !candidate.url_originale) return false;
          if (candidate.seller_manual_override === true) return false;
          if (Number(candidate.seller_classification_version || 0) < 3) return true;
          if (!candidate.url) return true;
          try {
            const link = new URL(candidate.url);
            const host = link.hostname.toLowerCase();
            const normalizedHost = host.startsWith("www.") ? host.slice(4) : host;
            const isImmobiliare = normalizedHost === "immobiliare.it" || normalizedHost.endsWith(".immobiliare.it");
            const path = link.pathname.toLowerCase();
            const genericPath = path === "/" ||
              ["/ricerca", "/search", "/vendita-case"].some(prefix => path === prefix || path.startsWith(prefix + "/"));
            return isImmobiliare && genericPath;
          } catch {
            return false;
          }
        })
        .map((candidate: any) => candidate.source_email_id as string);

      messageIds = [...new Set([...messageIds, ...repairIds])];

      const emails: Array<any | null> = [];
      for (let index = 0; index < messageIds.length; index += 5) {
        emails.push(
          ...await Promise.all(
            messageIds.slice(index, index + 5).map(id => readEmail(id, token))
          )
        );
      }

      const mailboxEmails = emails.filter(
        (email): email is any =>
          !!email && !email.labels.includes("SPAM") && !email.labels.includes("TRASH")
      );
      const propertyEmails = mailboxEmails.filter(email => propertyEmail(email));

      const { data: sellerRegistryRows, error: sellerRegistryError } = await ctx.supabaseAdmin
        .from("seller_identity_registry")
        .select("seller_type,identifier_type,identifier_normalized")
        .eq("owner_id", owner)
        .limit(1000);
      if (sellerRegistryError) throw new Error("Lettura del registro venditori verificati non riuscita");
      const sellerRegistry = (sellerRegistryRows || []) as SellerRegistryEntry[];

      const classifiedAll = propertyEmails.map(email => {
        const value = [email.subject, email.snippet, email.bodyText].filter(Boolean).join(" ");
        return { email, text: value, seller: classifySellerWithRegistry(value, sellerRegistry) };
      });
      const classified = classifiedAll.filter(item => item.seller.classification !== "Agenzia");
      const retainedIds = new Set(classified.map(item => String(item.email.id)));
      const discardedKeys = mailboxEmails
        .filter(email => !retainedIds.has(String(email.id)))
        .map(email => "gmail:" + String(email.id));

      let discardedExisting = 0;
      if (discardedKeys.length) {
        const { data: discarded, error: discardError } = await ctx.supabaseAdmin
          .from("annunci_candidati")
          .update({
            stato: "scartato",
            notification_sender: null,
            email_subject: null,
            updated_at: new Date().toISOString()
          })
          .eq("owner_id", owner)
          .eq("stato", "da_verificare")
          .eq("seller_manual_override", false)
          .in("dedup_key", discardedKeys)
          .select("id");

        if (discardError) throw new Error("Pulizia delle notifiche non pertinenti non riuscita");
        discardedExisting = discarded?.length || 0;
      }

      const rows = await Promise.all(classified.map(async ({ email, text, seller }) => {
        const originalUrl = listingUrl(text);
        const url = await resolveListingUrl(text);
        let portal: string | null = null;
        try {
          const portalUrl = url || originalUrl;
          if (portalUrl) {
            const host = new URL(portalUrl).hostname.toLowerCase().replace(/^www\./, "");
            portal = PORTALS.find(domain => host === domain || host.endsWith("." + domain)) || null;
          }
        } catch {
          portal = null;
        }

        return {
          owner_id: owner,
          titolo: listingTitle(email),
          comune: municipality(text),
          prezzo: price(text),
          tipologia_immobile: propertyType(text),
          superficie_mq: surface(text),
          locali: rooms(text),
          camere: bedrooms(text),
          bagni: bathrooms(text),
          tipo_venditore: seller.classification,
          seller_confidence: seller.confidence,
          seller_evidence: seller.evidence,
          seller_classification_version: 3,
          notification_sender: String(email.from || "").slice(0,300) || null,
          email_subject: String(email.subject || "").slice(0,500) || null,
          portale: portal || "Portale non indicato",
          url,
          url_originale: originalUrl,
          data_pubblicazione: email.date && !Number.isNaN(Date.parse(email.date))
            ? new Date(email.date).toISOString()
            : null,
          source_email_id: String(email.id),
          dedup_key: "gmail:" + String(email.id),
          stato: "da_verificare"
        };
      }));

      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        const { data: manualRow, error: manualCheckError } = await ctx.supabaseAdmin
          .from("annunci_candidati")
          .select("id,seller_manual_override")
          .eq("owner_id", owner)
          .eq("dedup_key", row.dedup_key)
          .eq("stato", "da_verificare")
          .maybeSingle();
        if (manualCheckError) throw new Error("Verifica classificazione manuale non riuscita");
        if (manualRow?.seller_manual_override === true) continue;
        const { data: existing, error: updateError } = await ctx.supabaseAdmin
          .from("annunci_candidati")
          .update({
            titolo: row.titolo,
            comune: row.comune,
            prezzo: row.prezzo,
            tipo_venditore: row.tipo_venditore,
            seller_confidence: row.seller_confidence,
            seller_evidence: row.seller_evidence,
            seller_classification_version: row.seller_classification_version,
            notification_sender: row.notification_sender,
            email_subject: row.email_subject,
            portale: row.portale,
            url: row.url,
            url_originale: row.url_originale,
            data_pubblicazione: row.data_pubblicazione,
            tipologia_immobile: row.tipologia_immobile,
            superficie_mq: row.superficie_mq,
            locali: row.locali,
            camere: row.camere,
            bagni: row.bagni,
            updated_at: new Date().toISOString()
          })
          .eq("owner_id", owner)
          .eq("dedup_key", row.dedup_key)
          .eq("stato", "da_verificare")
          .select("id");

        if (updateError) throw new Error("Aggiornamento degli annunci candidati non riuscito");
        updated += existing?.length || 0;
      }

      if (rows.length) {
        const { data: saved, error: saveError } = await ctx.supabaseAdmin
          .from("annunci_candidati")
          .upsert(rows, { onConflict: "owner_id,dedup_key", ignoreDuplicates: true })
          .select("id");

        if (saveError) throw new Error("Salvataggio annunci candidati non riuscito");
        inserted = saved?.length || 0;
      }

      await saveSyncCursor(ctx.supabaseAdmin, nextHistoryId);

      const excludedAgencies = propertyEmails.length - classified.length;
      const completedAt = new Date();
      const syncRun = {
        owner_id: owner,
        status: "success",
        sync_mode: syncMode,
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        duration_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        listed_count: messageIds.length,
        read_count: mailboxEmails.length,
        property_notifications_count: propertyEmails.length,
        private_recognized_count: rows.filter(row => row.tipo_venditore === "Privato").length,
        needs_user_review_count: rows.filter(row => row.tipo_venditore === "Da verificare").length,
        excluded_agencies_count: excludedAgencies,
        discarded_existing_count: discardedExisting,
        inserted_count: inserted,
        updated_count: updated,
        duplicates_or_existing_count: Math.max(0, rows.length - inserted - updated),
        missing_messages_count: emails.filter(email => !email).length,
        error_message: null
      };
      const { error: syncLogError } = await ctx.supabaseAdmin
        .from("nmre_gmail_sync_runs")
        .insert(syncRun);
      if (syncLogError) {
        console.error("Gmail sync monitor write failed:", syncLogError.message);
      }

      return Response.json({
        success: true,
        account: ACCOUNT,
        syncMode,
        historyRecords,
        listed: messageIds.length,
        read: mailboxEmails.length,
        propertyNotifications: propertyEmails.length,
        privateRecognized: rows.filter(row => row.tipo_venditore === "Privato").length,
        needsUserReview: rows.filter(row => row.tipo_venditore === "Da verificare").length,
        excludedAgencies,
        discardedExisting,
        inserted,
        updated,
        reprocessedExistingListingLinks: repairIds.length,
        duplicatesOrExisting: Math.max(0, rows.length - inserted - updated),
        missingMessages: emails.filter(email => !email).length
      });
    } catch (error) {
      if (ownerForLog && /^[0-9a-f-]{36}$/i.test(ownerForLog)) {
        const completedAt = new Date();
        const errorMessage = error instanceof Error
          ? error.message.slice(0, 400)
          : "Errore sincronizzazione Gmail";
        const { error: syncLogError } = await ctx.supabaseAdmin
          .from("nmre_gmail_sync_runs")
          .insert({
            owner_id: ownerForLog,
            status: "error",
            sync_mode: syncModeForLog,
            started_at: startedAt.toISOString(),
            completed_at: completedAt.toISOString(),
            duration_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
            error_message: errorMessage
          });
        if (syncLogError) {
          console.error("Gmail sync monitor error-log write failed:", syncLogError.message);
        }
      }

      console.error(
        "Errore Gmail scheduled reader:",
        error instanceof Error ? error.message : "Errore sconosciuto"
      );
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Errore sincronizzazione Gmail"
        },
        { status: 500 }
      );
    }
  })
};