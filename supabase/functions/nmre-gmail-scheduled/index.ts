import {
  municipality,price,listingPrice,listingUrl,propertyEmailDecision,listingTitle,propertyType,
  surface,rooms,bedrooms,bathrooms,resolveListingUrl,sellerClassificationDetails,canonicalListingKey,
  priceReduction,extractAdditionalPropertyDetails,specificPortalListingUrl
} from "./_shared/parser.ts";
import type { PropertyEmailRule } from "./_shared/parser.ts";
import { collectHistoryMessageIds } from "./_shared/history.ts";
import {
  existingCandidatePatch, isRepairEligible, keepAgencyCandidates, keptForReviewPatch, processedVersionMark
} from "./_shared/retention.ts";
import type { DiscardedNotificationPatchInfo, ExistingCandidateRow } from "./_shared/retention.ts";
import { guardedCandidateUpdate } from "./_shared/guarded.ts";
import { applyNotificationToExistingCandidate } from "./_shared/discard_flow.ts";
import {
  captureDubiousAlertsEnabled, dubiousAlertEvidence, promotedSellerClassification
} from "./_shared/dubious.ts";
import { withSupabase } from "npm:@supabase/server@^1";

const ACCOUNT = "nicholasmagirealestate@gmail.com";
const PORTALS = ["idealista.it","immobiliare.it","casa.it","subito.it","green-acres.it","green-acres.com","gate-away.com","trovacasa.it","wikicasa.it"];

function b64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function unb64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function decrypt(value: string, secret: string): Promise<Record<string, unknown>> {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Formato token cifrato non valido");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(parts[1]) },
    await encryptionKey(secret),
    unb64(parts[2])
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function encrypt(value: Record<string, unknown>, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(value))
  );
  return "v1." + b64(iv) + "." + b64(new Uint8Array(cipher));
}

async function accessToken(
  tokens: Record<string, unknown>,
  expiresAt: string,
  secret: string,
  admin: any
): Promise<string> {
  const refresh = tokens.refresh_token;
  if (typeof refresh !== "string" || !refresh) throw new Error("Refresh token non disponibile");
  if (new Date(expiresAt).getTime() > Date.now() + 60000 && typeof tokens.access_token === "string") {
    return tokens.access_token;
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Configurazione Google incompleta");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) throw new Error("Rinnovo del token Google non riuscito (" + response.status + ")");
  const fresh = await response.json();
  if (typeof fresh.access_token !== "string" || !fresh.access_token) {
    throw new Error("Token Google mancante");
  }

  const updated = {
    ...tokens,
    access_token: fresh.access_token,
    refresh_token: refresh,
    token_type: fresh.token_type || "Bearer",
    scope: fresh.scope || tokens.scope || ""
  };
  const expiry = new Date(Date.now() + Number(fresh.expires_in || 3600) * 1000).toISOString();
  const ciphertext = await encrypt(updated, secret);
  const { error } = await admin.rpc("nmre_save_gmail_tokens", {
    p_email: ACCOUNT,
    p_token_ciphertext: ciphertext,
    p_scope: String(updated.scope || ""),
    p_expires_at: expiry
  });
  if (error) throw new Error("Aggiornamento token Gmail non riuscito");
  return fresh.access_token;
}

async function gmailProfile(token: string): Promise<string> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error("Lettura profilo Gmail non riuscita (" + response.status + ")");
  const profile = await response.json();

  if (String(profile.emailAddress || "").toLowerCase() !== ACCOUNT) {
    throw new Error("La casella Gmail autorizzata non corrisponde");
  }
  const historyId = String(profile.historyId || "");
  if (!/^[0-9]{1,30}$/.test(historyId)) throw new Error("Cronologia Gmail non disponibile");
  return historyId;
}

async function readSyncCursor(admin: any): Promise<string | null> {
  const { data, error } = await admin.rpc("nmre_get_gmail_sync_state");
  if (error) throw new Error("Lettura dello stato di sincronizzazione Gmail non riuscita");
  const row = Array.isArray(data) ? data[0] : data;
  const value = String(row?.history_id || "");
  return /^[0-9]{1,30}$/.test(value) ? value : null;
}

async function saveSyncCursor(admin: any, historyId: string): Promise<void> {
  const { error } = await admin.rpc("nmre_save_gmail_sync_state", { p_history_id: historyId });
  if (error) throw new Error("Salvataggio dello stato di sincronizzazione Gmail non riuscito");
}

async function listFullSyncMessageIds(token: string): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const params = new URLSearchParams({ maxResults: "100", q: "newer_than:30d" });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?" + params.toString(),
      {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(20000)
      }
    );
    if (!response.ok) throw new Error("Ricerca Gmail non riuscita (" + response.status + ")");

    const result = await response.json();
    for (const message of Array.isArray(result.messages) ? result.messages : []) {
      if (typeof message?.id === "string" && message.id) ids.add(message.id);
    }

    pageToken = typeof result.nextPageToken === "string" ? result.nextPageToken : undefined;
    pages++;
    if (pageToken && pages >= 100) {
      throw new Error("La sincronizzazione completa supera il limite di sicurezza di 10.000 messaggi; il cursore non è stato aggiornato");
    }
  } while (pageToken);

  return [...ids];
}

type HistorySyncResult = {
  ids: string[];
  historyId: string;
  historyRecords: number;
};

async function listHistoryMessageIds(
  token: string,
  startHistoryId: string
): Promise<HistorySyncResult | null> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId: string | null = null;
  let historyRecords = 0;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      maxResults: "500"
    });
    params.append("historyTypes", "messageAdded");
    params.append("historyTypes", "labelAdded");
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/history?" + params.toString(),
      {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(20000)
      }
    );

    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Lettura della cronologia Gmail non riuscita (" + response.status + ")");

    const result = await response.json();
    const history = Array.isArray(result.history) ? result.history : [];
    historyRecords += history.length;
    for (const id of collectHistoryMessageIds(history)) ids.add(id);

    if (typeof result.historyId === "string" && /^[0-9]{1,30}$/.test(result.historyId)) {
      latestHistoryId = result.historyId;
    }

    pageToken = typeof result.nextPageToken === "string" ? result.nextPageToken : undefined;
    pages++;
    if (pageToken && pages >= 20) {
      throw new Error("La cronologia Gmail supera il limite di sicurezza di 10.000 record; il cursore non è stato aggiornato");
    }
  } while (pageToken);

  if (!latestHistoryId) throw new Error("Gmail non ha restituito il nuovo identificativo della cronologia");
  return { ids: [...ids], historyId: latestHistoryId, historyRecords };
}

function decode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Uint8Array.from(binary, character => character.charCodeAt(0))
  );
}

function bodyParts(part: any): string[] {
  const output: string[] = [];
  if (part?.body?.data && part.mimeType === "text/plain") {
    output.push(decode(part.body.data));
  } else if (part?.body?.data && part.mimeType === "text/html") {
    const html = decode(part.body.data)
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
      .replace(/<\s*a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, " $1 ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
    output.push(html);
  }
  for (const child of part?.parts || []) output.push(...bodyParts(child));
  return output;
}

async function readEmail(messageId: string, token: string): Promise<any | null> {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(messageId) + "?format=full",
    {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(20000)
    }
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Lettura del messaggio Gmail non riuscita (" + response.status + ")");

  const email = await response.json();
  const headers = email.payload?.headers || [];
  const get = (name: string) =>
    headers.find((header: any) => header.name?.toLowerCase() === name.toLowerCase())?.value || "";

  return {
    id: email.id,
    labels: Array.isArray(email.labelIds) ? email.labelIds : [],
    from: get("From"),
    subject: get("Subject"),
    date: get("Date"),
    messageIdHeader: get("Message-ID").slice(0, 300),
    snippet: (email.snippet || "").slice(0, 500),
    bodyText: bodyParts(email.payload).join("\n").slice(0, 30000)
  };
}


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


async function ensureGmailWatch(
  token: string,
  admin: any
): Promise<{ configured: boolean; active: boolean; expiration: string | null }> {
  const topicName = Deno.env.get("GMAIL_PUBSUB_TOPIC_NAME");
  if (!topicName) return { configured: false, active: false, expiration: null };
  if (!/^projects\/[A-Za-z0-9:._-]+\/topics\/[A-Za-z0-9._~-]+$/.test(topicName)) {
    console.error("GMAIL_PUBSUB_TOPIC_NAME non ha un formato valido");
    return { configured: true, active: false, expiration: null };
  }

  try {
    const { data: stateRows, error: stateError } = await admin.rpc("nmre_get_gmail_push_watch_state");
    if (stateError) throw new Error("Lettura stato Gmail Watch non riuscita");
    const state = Array.isArray(stateRows) ? stateRows[0] : stateRows;
    const currentExpiration = state?.expiration ? new Date(state.expiration).getTime() : 0;
    if (Number.isFinite(currentExpiration) && currentExpiration > Date.now() + 24 * 60 * 60 * 1000) {
      return { configured: true, active: true, expiration: new Date(currentExpiration).toISOString() };
    }

    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ topicName }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error("Registrazione Gmail Watch non riuscita (" + response.status + ")");
    const watch = await response.json();
    const historyId = String(watch.historyId || "");
    const expirationMs = Number(watch.expiration || 0);
    if (!/^[0-9]{1,30}$/.test(historyId) || !Number.isFinite(expirationMs) ||
        expirationMs <= Date.now() || expirationMs > Date.now() + 8 * 24 * 60 * 60 * 1000) {
      throw new Error("Risposta Gmail Watch non valida");
    }
    const expiration = new Date(expirationMs).toISOString();
    const { error: saveError } = await admin.rpc("nmre_save_gmail_push_watch_state", {
      p_history_id: historyId,
      p_expiration: expiration
    });
    if (saveError) throw new Error("Salvataggio stato Gmail Watch non riuscito");
    return { configured: true, active: true, expiration };
  } catch (error) {
    console.error(
      "Gmail Push Watch non disponibile; resta attivo il controllo periodico:",
      error instanceof Error ? error.message : "Errore sconosciuto"
    );
    return { configured: true, active: false, expiration: null };
  }
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Metodo non consentito" }, { status: 405 });
    }

    const startedAt = new Date();
    let ownerForLog: string | null = null;
    let syncModeForLog: "full_initial" | "full_recovery" | "incremental" | null = null;
    let syncLockToken: string | null = null;

    try {
      const owner = Deno.env.get("NMRE_ALLOWED_USER_ID");
      ownerForLog = owner || null;
      const encryptionSecret = Deno.env.get("INTEGRATION_TOKEN_ENCRYPTION_KEY");
      if (!owner || !/^[0-9a-f-]{36}$/i.test(owner) || !encryptionSecret) {
        throw new Error("Configurazione server incompleta");
      }

      const lockToken = crypto.randomUUID();
      const { data: lockAcquired, error: lockError } = await ctx.supabaseAdmin.rpc(
        "nmre_try_acquire_gmail_sync_lock",
        { p_lock_token: lockToken, p_lease_seconds: 300 }
      );
      if (lockError) throw new Error("Acquisizione blocco sincronizzazione Gmail non riuscita");
      if (lockAcquired !== true) {
        return Response.json({ success: true, skipped: "sync_in_progress" }, { status: 202 });
      }
      syncLockToken = lockToken;

      const { data, error } = await ctx.supabaseAdmin.rpc("nmre_get_gmail_tokens");
      if (error || !data?.[0]?.token_ciphertext) throw new Error("Collegamento Gmail non trovato");
      if (data[0].email?.toLowerCase() !== ACCOUNT) throw new Error("Casella Gmail non autorizzata");

      const tokens = await decrypt(data[0].token_ciphertext, encryptionSecret);
      const token = await accessToken(tokens, data[0].expires_at, encryptionSecret, ctx.supabaseAdmin);
      const pushWatch = await ensureGmailWatch(token, ctx.supabaseAdmin);
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
        .select("source_email_id,url,url_originale,stato,seller_classification_version,data_extraction_version,seller_manual_override,deduplication_version,listing_key")
        .eq("owner_id", owner)
        .eq("stato", "da_verificare")
        .not("source_email_id", "is", null)
        // I più vecchi per primi: se gli idonei superano il limite, nessuno resta
        // escluso a tempo indeterminato.
        .order("updated_at", { ascending: true })
        .limit(200);

      if (repairQueryError) throw new Error("Lettura dei link da correggere non riuscita");
      // Ogni email legacy viene rielaborata una sola volta: dopo la lettura il
      // candidato viene marcato con le versioni attuali (anche quando è una copia
      // storica o non è più riconosciuto come avviso), così non torna a ogni ciclo.
      // Le classificazioni manuali non vengono rielaborate.
      const repairIds = (candidatesToRepair || [])
        .filter((candidate: any) => isRepairEligible(candidate))
        .map((candidate: any) => candidate.source_email_id as string);

      // Avvisi dubbi (Fase 2): attivi solo con NMRE_CAPTURE_DUBIOUS_ALERTS=true e
      // DOPO l'applicazione della migrazione della tabella nmre_gmail_avvisi_dubbi.
      // Gli avvisi che il titolare ha chiesto di promuovere vengono riletti e
      // trattati come avvisi accettati, senza cambiare le regole del filtro.
      const captureDubious = captureDubiousAlertsEnabled(Deno.env.get("NMRE_CAPTURE_DUBIOUS_ALERTS"));
      const forcedIds = new Set<string>();
      if (captureDubious) {
        const { data: toPromote, error: promoteQueryError } = await ctx.supabaseAdmin
          .from("nmre_gmail_avvisi_dubbi")
          .select("gmail_message_id")
          .eq("owner_id", owner)
          .eq("stato", "da_promuovere")
          .order("updated_at", { ascending: true })
          .limit(50);
        if (promoteQueryError) throw new Error("Lettura degli avvisi dubbi da promuovere non riuscita");
        for (const item of toPromote || []) {
          if (typeof item.gmail_message_id === "string" && item.gmail_message_id) forcedIds.add(item.gmail_message_id);
        }
      }

      messageIds = [...new Set([...messageIds, ...repairIds, ...forcedIds])];

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
      // Diagnostica del filtro avvisi: solo conteggi per nome di regola, nessun testo.
      const filterRuleById = new Map<string, PropertyEmailRule>();
      const propertyFilterRules: Record<string, number> = {};
      for (const email of mailboxEmails) {
        const decision = propertyEmailDecision(email);
        filterRuleById.set(String(email.id), decision.rule);
        propertyFilterRules[decision.rule] = (propertyFilterRules[decision.rule] || 0) + 1;
      }
      const isForced = (email: any) => forcedIds.has(String(email.id));
      const propertyEmails = mailboxEmails.filter(email =>
        filterRuleById.get(String(email.id)) === "accettata" || isForced(email)
      );

      // Rete di sicurezza: le email escluse dal filtro con una prova oggettiva di
      // riferirsi a un annuncio vengono conservate come avvisi dubbi (riferimento
      // all'email, regola, portale, link e oggetto; mai il testo del messaggio).
      let dubiousAlertsSaved = 0;
      if (captureDubious) {
        const dubiousRows = [];
        // Le email rilette per la rielaborazione hanno già un candidato: non sono
        // avvisi dubbi nuovi (vengono gestite come "conservato_non_riconosciuto").
        const repairIdSet = new Set(repairIds);
        for (const email of mailboxEmails) {
          if (isForced(email) || repairIdSet.has(String(email.id))) continue;
          const rule = filterRuleById.get(String(email.id)) || "accettata";
          const fullText = [email.subject, email.snippet, email.bodyText].filter(Boolean).join(" ");
          const evidence = dubiousAlertEvidence(rule, email, specificPortalListingUrl(fullText), PORTALS);
          if (!evidence) continue;
          dubiousRows.push({
            owner_id: owner,
            gmail_message_id: String(email.id),
            rfc822_message_id: email.messageIdHeader || null,
            ricevuto_il: email.date && !Number.isNaN(Date.parse(email.date)) ? new Date(email.date).toISOString() : null,
            regola_esclusione: rule,
            prova: evidence.reason,
            portale: evidence.portal,
            link_annuncio: evidence.listingUrl,
            oggetto: String(email.subject || "").slice(0, 300) || null
          });
        }
        // Un'email che ha già un candidato (per esempio riletta per un cambio di
        // etichetta) non è un avviso dubbio: resta gestita dal suo candidato.
        if (dubiousRows.length) {
          const { data: existingForDubious, error: existingForDubiousError } = await ctx.supabaseAdmin
            .from("annunci_candidati")
            .select("dedup_key")
            .eq("owner_id", owner)
            .in("dedup_key", dubiousRows.map(row => "gmail:" + row.gmail_message_id));
          if (existingForDubiousError) throw new Error("Verifica dei candidati esistenti per gli avvisi dubbi non riuscita");
          const existingKeys = new Set((existingForDubious || []).map((row: any) => String(row.dedup_key)));
          for (let index = dubiousRows.length - 1; index >= 0; index--) {
            if (existingKeys.has("gmail:" + dubiousRows[index].gmail_message_id)) dubiousRows.splice(index, 1);
          }
        }
        if (dubiousRows.length) {
          const { data: savedDubious, error: dubiousError } = await ctx.supabaseAdmin
            .from("nmre_gmail_avvisi_dubbi")
            .upsert(dubiousRows, { onConflict: "owner_id,gmail_message_id", ignoreDuplicates: true })
            .select("id");
          // Errore bloccante: il cursore non avanza e gli avvisi vengono ritentati.
          if (dubiousError) throw new Error("Salvataggio degli avvisi dubbi non riuscito");
          dubiousAlertsSaved = savedDubious?.length || 0;
        }
      }

      const { data: sellerRegistryRows, error: sellerRegistryError } = await ctx.supabaseAdmin
        .from("seller_identity_registry")
        .select("seller_type,identifier_type,identifier_normalized")
        .eq("owner_id", owner)
        .limit(1000);
      if (sellerRegistryError) throw new Error("Lettura del registro venditori verificati non riuscita");
      const sellerRegistry = (sellerRegistryRows || []) as SellerRegistryEntry[];

      const classifiedAll = propertyEmails.map(email => {
        const value = [email.subject, email.snippet, email.bodyText].filter(Boolean).join(" ");
        const seller = classifySellerWithRegistry(value, sellerRegistry);
        // Un avviso promosso dal titolare resta sempre visibile in coda.
        return { email, text: value, seller: isForced(email) ? promotedSellerClassification(seller) : seller };
      });
      // Le email classificate come agenzia vengono conservate come candidati
      // "Agenzia" (fuori dalla coda principale ma recuperabili dall'interfaccia).
      // NMRE_KEEP_AGENCY_CANDIDATES=false ripristina il comportamento precedente.
      const keepAgency = keepAgencyCandidates(Deno.env.get("NMRE_KEEP_AGENCY_CANDIDATES"));
      const classified = keepAgency
        ? classifiedAll
        : classifiedAll.filter(item => item.seller.classification !== "Agenzia");
      const retainedIds = new Set(classified.map(item => String(item.email.id)));
      const notRetainedEmails = mailboxEmails.filter(email => !retainedIds.has(String(email.id)));
      const notRetainedKeys = notRetainedEmails.map(email => "gmail:" + String(email.id));

      // Nessuno scarto automatico: un candidato già salvato la cui email non viene
      // più riconosciuta come avviso resta nel suo stato. Si registra soltanto la
      // regola che lo ha escluso e lo si marca come elaborato, per non rileggerlo
      // a ogni sincronizzazione.
      const discardedExisting = 0;
      let keptForReview = 0;
      for (let index = 0; index < notRetainedKeys.length; index += 200) {
        const { data: notRetainedRows, error: notRetainedError } = await ctx.supabaseAdmin
          .from("annunci_candidati")
          .select("id,dedup_key,source_email_id,dati_estratti,deduplication_version,data_extraction_version,seller_classification_version")
          .eq("owner_id", owner)
          .in("dedup_key", notRetainedKeys.slice(index, index + 200));
        if (notRetainedError) throw new Error("Lettura delle notifiche non riconosciute non riuscita");

        for (const candidate of notRetainedRows || []) {
          const filterRule = filterRuleById.get(String(candidate.source_email_id || ""));
          // Un'email che ha superato il filtro ma non è stata trattenuta è stata
          // classificata come agenzia con NMRE_KEEP_AGENCY_CANDIDATES=false.
          const rule = !filterRule || filterRule === "accettata" ? "classificata_agenzia" : filterRule;
          // Aggiornamento protetto: la voce di storico si aggiunge al valore appena riletto.
          const kept = await guardedCandidateUpdate(ctx.supabaseAdmin, owner, String(candidate.id),
            "id,dati_estratti,deduplication_version,data_extraction_version,seller_classification_version,updated_at",
            (current: any) => keptForReviewPatch(current, rule, new Date().toISOString()));
          if (kept.status === "error") throw new Error("Aggiornamento delle notifiche non riconosciute non riuscito");
          if (kept.status === "updated") keptForReview++;
        }
      }

      const rows = await Promise.all(classified.map(async ({ email, text, seller }) => {
        const originalUrl = listingUrl(text);
        const url = await resolveListingUrl(text);
        const title = listingTitle(email);
        const explicitPriceReduction = priceReduction(text + " " + title);
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
          titolo: title,
          comune: municipality(text),
          prezzo: listingPrice(text, title),
          explicit_price_reduction: explicitPriceReduction,
          tipologia_immobile: propertyType(text),
          superficie_mq: surface(text),
          locali: rooms(text),
          camere: bedrooms(text),
          bagni: bathrooms(text),
          dati_estratti: {
            ...extractAdditionalPropertyDetails(text),
            riduzione_prezzo: explicitPriceReduction,
            campi_immobile: {
              titolo: title,
              comune: municipality(text),
              prezzo: listingPrice(text, title),
              tipologia: propertyType(text),
              superficie_mq: surface(text),
              locali: rooms(text),
              camere: bedrooms(text),
              bagni: bathrooms(text)
            }
          },
          dati_fonte: {
            provider: "Gmail",
            source_email_id: String(email.id),
            received_at: email.date && !Number.isNaN(Date.parse(email.date)) ? new Date(email.date).toISOString() : null,
            sender: String(email.from || "").slice(0,300) || null,
            subject: String(email.subject || "").slice(0,500) || null,
            snippet: String(email.snippet || "").slice(0,500),
            body_text: String(email.bodyText || "").slice(0,30000),
            captured_at: new Date().toISOString()
          },
          data_extraction_version: 6,
          tipo_venditore: seller.classification,
          seller_confidence: seller.confidence,
          seller_evidence: seller.evidence,
          seller_classification_version: 3,
          notification_sender: String(email.from || "").slice(0,300) || null,
          email_subject: String(email.subject || "").slice(0,500) || null,
          portale: portal || "Portale non indicato",
          url,
          url_originale: originalUrl,
          // Legacy column name: this is Gmail's Date header (notification receipt),
          // not the original publication date of the property listing on the portal.
          data_pubblicazione: email.date && !Number.isNaN(Date.parse(email.date))
            ? new Date(email.date).toISOString()
            : null,
          source_email_id: String(email.id),
          dedup_key: "gmail:" + String(email.id),
          listing_key: canonicalListingKey(url),
          deduplication_version: 1,
          stato: "da_verificare"
        };
      }));

      let inserted = 0;
      let updated = 0;
      let notificationEventsLinked = 0;
      let autoArchived = 0;
      let reopenedOnPriceDrop = 0;
      let notificationsAfterDiscard = 0;
      const promotedCandidateByEmail = new Map<string, string>();
      for (const row of rows) {
        const { data: currentCandidate, error: currentError } = await ctx.supabaseAdmin
          .from("annunci_candidati")
          .select("id,seller_manual_override,stato,listing_key,tipo_venditore,dati_estratti,deduplication_version,data_extraction_version,seller_classification_version")
          .eq("owner_id", owner)
          .eq("dedup_key", row.dedup_key)
          .maybeSingle();
        if (currentError) throw new Error("Verifica della notifica Gmail già registrata non riuscita");

        let canonicalCandidate: any = null;
        if (row.listing_key) {
          const { data, error } = await ctx.supabaseAdmin
            .from("annunci_candidati")
            .select("id,seller_manual_override,stato,listing_key,tipo_venditore,dati_estratti,deduplication_version,data_extraction_version,seller_classification_version")
            .eq("owner_id", owner)
            .eq("listing_key", row.listing_key)
            .maybeSingle();
          if (error) throw new Error("Ricerca dell'immobile già acquisito non riuscita");
          canonicalCandidate = data;
        }

        const existingCandidate = canonicalCandidate || currentCandidate;
        let candidateId: string | null = null;

        if (existingCandidate) {
          candidateId = String(existingCandidate.id);
          // Aggiornamento protetto: la modifica è calcolata dal candidato appena riletto
          // (stato, classificazione manuale, storico, dati della pagina) e scritta solo se
          // il record non è cambiato nel frattempo. Gli scartati e gli archiviati
          // ricevono solo i segni tecnici; la notifica resta nello storico e la decisione
          // su ribassi e nuove notifiche viene presa più avanti.
          const existingResult = await guardedCandidateUpdate(ctx.supabaseAdmin, owner, candidateId,
            "id,stato,seller_manual_override,tipo_venditore,dati_estratti,listing_key,updated_at",
            (current: any) => existingCandidatePatch(current, row as unknown as ExistingCandidateRow, new Date().toISOString()));
          const updateError = existingResult.status === "error" ? existingResult.error : null;
          if (existingResult.status === "missing") throw new Error("Il candidato da aggiornare non esiste più");
          if (updateError) {
            // Un altro ciclo potrebbe aver associato la stessa scheda nello stesso istante.
            if (updateError.code !== "23505") {
              throw new Error("Aggiornamento dell'immobile candidato non riuscito");
            }
            if (row.listing_key) {
              const { data: raced, error: raceError } = await ctx.supabaseAdmin
                .from("annunci_candidati")
                .select("id")
                .eq("owner_id", owner)
                .eq("listing_key", row.listing_key)
                .maybeSingle();
              if (raceError || !raced) throw new Error("Conflitto durante la deduplicazione dell'immobile");
              candidateId = String(raced.id);
            }
          } else if (existingResult.status === "updated") {
            updated++;
          }

          // La riga email legacy (copia storica dello stesso immobile) resta intatta
          // nei dati, ma viene marcata con le versioni attuali: senza questo
          // segno resterebbe idonea alla rielaborazione e verrebbe riletta da
          // Gmail a ogni sincronizzazione.
          if (currentCandidate && String(currentCandidate.id) !== candidateId) {
            const legacyMark = await guardedCandidateUpdate(ctx.supabaseAdmin, owner, String(currentCandidate.id),
              "id,deduplication_version,data_extraction_version,seller_classification_version,updated_at",
              (current: any) => processedVersionMark(current));
            if (legacyMark.status === "error") throw new Error("Aggiornamento dello stato di deduplicazione non riuscito");
          }
        } else {
          // explicit_price_reduction is an internal parsing value, not a database column.
          // Keep it on row for price-history processing, but omit it from the candidate INSERT.
          const { explicit_price_reduction: _explicitPriceReduction, ...candidateInsert } = row;
          const { data: saved, error: insertError } = await ctx.supabaseAdmin
            .from("annunci_candidati")
            .insert(candidateInsert)
            .select("id")
            .maybeSingle();

          if (insertError) {
            if (insertError.code !== "23505") {
              throw new Error("Salvataggio dell'immobile candidato non riuscito");
            }
            let raced: any = null;
            if (row.listing_key) {
              const { data, error } = await ctx.supabaseAdmin
                .from("annunci_candidati")
                .select("id")
                .eq("owner_id", owner)
                .eq("listing_key", row.listing_key)
                .maybeSingle();
              if (error) throw new Error("Verifica del duplicato concorrente non riuscita");
              raced = data;
            }
            if (!raced) {
              const { data, error } = await ctx.supabaseAdmin
                .from("annunci_candidati")
                .select("id")
                .eq("owner_id", owner)
                .eq("dedup_key", row.dedup_key)
                .maybeSingle();
              if (error || !data) throw new Error("Impossibile recuperare l'immobile salvato durante la deduplicazione");
              raced = data;
            }
            candidateId = String(raced.id);
            updated++;
          } else {
            if (!saved?.id) throw new Error("Il database non ha restituito l'identificativo del candidato salvato");
            candidateId = String(saved.id);
            inserted++;
          }
        }

        if (!candidateId) throw new Error("Impossibile associare la notifica all'immobile");

        // Il vecchio prezzo viene memorizzato solo se dichiarato dal portale
        // oppure se una notifica precedente dello stesso annuncio prova un importo maggiore.
        let previousPrice: number | null = row.explicit_price_reduction?.previousPrice ?? null;
        // Ultimo prezzo già registrato da un'altra notifica dello stesso candidato: serve
        // anche a capire se un ribasso è NUOVO rispetto a quanto già noto.
        let lastRecordedPrice: number | null = null;
        if ((previousPrice === null && Number(row.prezzo) > 0) || existingCandidate) {
          const { data: priorSnapshot, error: priorSnapshotError } = await ctx.supabaseAdmin
            .from("annunci_candidati_notifiche")
            .select("listing_price")
            .eq("owner_id", owner)
            .eq("candidate_id", candidateId)
            .neq("source_email_id", row.source_email_id)
            .not("listing_price", "is", null)
            .order("notified_at", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (priorSnapshotError) throw new Error("Lettura dello storico prezzi non riuscita");
          const lastPrice = Number(priorSnapshot?.listing_price);
          if (priorSnapshot && Number.isFinite(lastPrice) && lastPrice > 0) lastRecordedPrice = lastPrice;
          if (previousPrice === null && Number(row.prezzo) > 0 && Number.isFinite(lastPrice) && lastPrice > Number(row.prezzo)) {
            const historicalDropPercent = ((lastPrice - Number(row.prezzo)) / lastPrice) * 100;
            // Le vecchie notifiche possono contenere prezzi estratti male:
            // un calo superiore al 50% non viene attribuito senza conferma esplicita del portale.
            if (historicalDropPercent > 0 && historicalDropPercent <= 50) previousPrice = lastPrice;
          }
        }

        const currentPrice = row.explicit_price_reduction?.currentPrice
          ?? (Number(row.prezzo) > 0 ? Number(row.prezzo) : null);
        const hasPriceDrop = currentPrice !== null && previousPrice !== null && previousPrice > currentPrice;
        const priceDropAmount = hasPriceDrop ? Number(previousPrice) - currentPrice : null;
        const priceDropPercent = hasPriceDrop
          ? Math.round((priceDropAmount! / previousPrice!) * 10000) / 100
          : null;

        // Per un candidato già esistente serve sapere se la notifica era già acquisita
        // (rilettura della stessa email) e quando: lo storico notifiche è la fonte
        // affidabile (chiave owner_id + source_email_id).
        let knownNotificationCreatedAt: string | null = null;
        if (existingCandidate) {
          const { data: knownNotification, error: knownNotificationError } = await ctx.supabaseAdmin
            .from("annunci_candidati_notifiche")
            .select("source_email_id,created_at")
            .eq("owner_id", owner)
            .eq("source_email_id", row.source_email_id)
            .maybeSingle();
          if (knownNotificationError) throw new Error("Verifica dello storico notifiche non riuscita");
          // Una notifica già registrata senza data viene trattata come molto vecchia (nessuna riapertura).
          knownNotificationCreatedAt = knownNotification ? String(knownNotification.created_at || "1970-01-01T00:00:00Z") : null;
        }

        const { error: notificationError } = await ctx.supabaseAdmin
          .from("annunci_candidati_notifiche")
          .upsert({
            owner_id: owner,
            candidate_id: candidateId,
            source_email_id: row.source_email_id,
            notification_sender: row.notification_sender,
            email_subject: row.email_subject,
            notified_at: row.data_pubblicazione,
            listing_url: row.url || row.url_originale,
            listing_price: currentPrice,
            previous_price: hasPriceDrop ? previousPrice : null,
            price_drop_amount: priceDropAmount,
            price_drop_percent: priceDropPercent,
            listing_surface_mq: row.superficie_mq,
            listing_title: row.titolo,
            listing_municipality: row.comune
          }, { onConflict: "owner_id,source_email_id" });
        if (notificationError) throw new Error("Salvataggio dello storico notifiche non riuscito");
        notificationEventsLinked++;
        if (forcedIds.has(row.source_email_id)) promotedCandidateByEmail.set(row.source_email_id, candidateId);

        // Notifiche su un candidato scartato. La decisione è presa sul valore appena
        // riletto (aggiornamento protetto) e non si ripete per la stessa email:
        // - nuova notifica con un NUOVO ribasso → il candidato torna "da verificare";
        // - nuova notifica senza nuovo ribasso → resta scartato ma viene evidenziato;
        // - rilettura di un'email già acquisita prima dell'ultimo scarto, o già gestita →
        //   nessuna modifica: la decisione dell'utente prevale.
        if (existingCandidate) {
          const patchInfo: DiscardedNotificationPatchInfo = {
            data: row.data_pubblicazione || new Date().toISOString(),
            source_email_id: row.source_email_id,
            prezzo: currentPrice,
            ribasso_percentuale: priceDropPercent,
            titolo: row.titolo,
            comune: row.comune,
            portale: row.portale,
            priceDropPercent
          };
          const outcome = await applyNotificationToExistingCandidate(ctx.supabaseAdmin, owner, {
            candidateId, knownNotificationCreatedAt, hasPriceDrop, currentPrice, lastRecordedPrice, info: patchInfo
          });
          if (outcome.written && outcome.action === "reopen") reopenedOnPriceDrop++;
          if (outcome.written && outcome.action === "mark") notificationsAfterDiscard++;
        }

        // Archivia solo i privati con prova esplicita ad alta affidabilita o verifica manuale gia salvata.
        if (row.tipo_venditore === "Privato") {
          const { data: archiveResult, error: archiveError } = await ctx.supabaseAdmin
            .rpc("nmre_auto_archive_private_candidate", { p_candidate_id: candidateId });
          if (archiveError) throw new Error("Archiviazione automatica del privato non riuscita");
          if (archiveResult?.archived === true) autoArchived++;
        }
      }

      // Esito delle promozioni richieste dal titolare.
      let promotedAlerts = 0;
      for (const gmailId of forcedIds) {
        const candidateId = promotedCandidateByEmail.get(gmailId);
        const update = candidateId
          ? { stato: "promosso", candidato_id: candidateId, updated_at: new Date().toISOString() }
          : {
            stato: "da_verificare",
            decisione_motivo: "Promozione non completata: email non più disponibile in Gmail, in spam o nel cestino",
            updated_at: new Date().toISOString()
          };
        const { error: promoteError } = await ctx.supabaseAdmin
          .from("nmre_gmail_avvisi_dubbi")
          .update(update)
          .eq("owner_id", owner)
          .eq("gmail_message_id", gmailId)
          .eq("stato", "da_promuovere");
        if (promoteError) throw new Error("Aggiornamento degli avvisi promossi non riuscito");
        if (candidateId) promotedAlerts++;
      }

      await saveSyncCursor(ctx.supabaseAdmin, nextHistoryId);

      // Con NMRE_KEEP_AGENCY_CANDIDATES attivo le agenzie restano salvate: il
      // contatore indica le notifiche tenute fuori dalla coda principale.
      const excludedAgencies = keepAgency
        ? rows.filter(row => row.tipo_venditore === "Agenzia").length
        : propertyEmails.length - classified.length;
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
        auto_archived_count: autoArchived,
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
      // Riepilogo diagnostico nei log della funzione: solo conteggi e nomi di regola.
      console.log("nmre-gmail-scheduled summary", JSON.stringify({
        syncMode, propertyFilterRules, keptForReview, reopenedOnPriceDrop, notificationsAfterDiscard,
        agencyCandidatesKept: keepAgency, excludedAgencies, dubiousAlertsCaptured: captureDubious,
        dubiousAlertsSaved, promotedAlerts
      }));

      return Response.json({
        success: true,
        account: ACCOUNT,
        pushNotifications: pushWatch,
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
        autoArchived,
        notificationEventsLinked,
        reprocessedExistingListingLinks: repairIds.length,
        agencyCandidatesKept: keepAgency,
        keptForReview,
        reopenedOnPriceDrop,
        notificationsAfterDiscard,
        dubiousAlertsCaptured: captureDubious,
        dubiousAlertsSaved,
        promotedAlerts,
        propertyFilterRules,
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
    } finally {
      if (syncLockToken) {
        try {
          const { error: releaseError } = await ctx.supabaseAdmin.rpc(
            "nmre_release_gmail_sync_lock",
            { p_lock_token: syncLockToken }
          );
          if (releaseError) console.error("Rilascio blocco Gmail non riuscito:", releaseError.message);
        } catch (releaseError) {
          console.error("Rilascio blocco Gmail non riuscito:", releaseError);
        }
      }
    }
  })
};