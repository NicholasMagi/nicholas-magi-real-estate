import {
  municipality,price,listingPrice,listingUrl,listingTitle,propertyType,
  surface,rooms,bedrooms,bathrooms,resolveListingUrl,sellerClassificationDetails,canonicalListingKey,
  priceReduction,extractAdditionalPropertyDetails,specificPortalListingUrl
} from "./_shared/parser.ts";
import { collectHistoryMessageIds } from "./_shared/history.ts";
import { isRepairEligible, keepAgencyCandidates, keptForReviewPatch } from "./_shared/retention.ts";
import { guardedCandidateUpdate } from "./_shared/guarded.ts";
import { newSaveCounters, saveCandidateRow } from "./_shared/save_candidate.ts";
import type { CandidateRow } from "./_shared/save_candidate.ts";
import { classifyMailbox, emailFromGmailMessage, repairEmailId, sellerForEmail } from "./_shared/mailbox.ts";
import { subitoItemCandidatesEnabled, subitoRowsForEmails, supabaseSubitoDeps } from "./_shared/subito_acquisition.ts";
import { assertAllRowsSaved, processRowsIsolated } from "./_shared/row_isolation.ts";
import type { RowFailure } from "./_shared/row_isolation.ts";
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

// Pagina pubblica dei risultati Subito: normale richiesta GET, nessun tentativo di
// aggirare CAPTCHA, verifiche anti-robot o autenticazioni (gestiti come errore).
async function fetchSubitoPage(url: string): Promise<{ status: number; finalUrl: string; html: string }> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "it-IT,it;q=0.9" },
    signal: AbortSignal.timeout(12000)
  });
  const html = (await response.text()).slice(0, 3_000_000);
  return { status: response.status, finalUrl: response.url || url, html };
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

  return emailFromGmailMessage(await response.json());
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
        // Annunci di una ricerca salvata Subito: si rilegge l'email riepilogativa.
        .map((candidate: any) => repairEmailId(candidate.source_email_id));

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
      // Regola del filtro avvisi (diagnostica: solo conteggi) ed email Subito di ricerca
      // salvata, riconosciute a parte e accettate (_shared/mailbox.ts).
      const { subitoDigestById, filterRuleById, propertyFilterRules } = classifyMailbox(mailboxEmails);
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
        // Il riepilogo di una ricerca salvata non è un annuncio: mai "Privato".
        const seller = sellerForEmail(String(email.id), subitoDigestById, () => classifySellerWithRegistry(value, sellerRegistry));
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
      // Errori di singole email: raccolti, non bloccano le altre; il cursore non avanza.
      const rowFailures: RowFailure[] = [];
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
          try {
            const kept = await guardedCandidateUpdate(ctx.supabaseAdmin, owner, String(candidate.id),
              "id,source_email_id,dati_estratti,deduplication_version,data_extraction_version,seller_classification_version,updated_at",
              (current: any) => keptForReviewPatch(current, rule, new Date().toISOString(), String(candidate.source_email_id || "") || null));
            if (kept.status === "error") throw new Error("Aggiornamento delle notifiche non riconosciute non riuscito");
            if (kept.status === "updated") keptForReview++;
          } catch (error) {
            rowFailures.push({ sourceEmailId: String(candidate.source_email_id || candidate.id), reason: error instanceof Error ? error.message.slice(0, 160) : "errore sconosciuto" });
          }
        }
      }

      const regularClassified = classified.filter(item => !subitoDigestById.has(String(item.email.id)));
      const subitoClassified = classified.filter(item => subitoDigestById.has(String(item.email.id)));
      const regularRows = await Promise.all(regularClassified.map(async ({ email, text, seller }) => {
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

      // Ricerche salvate Subito: un annuncio per riga, con il proprio URL e ID. In caso di
      // incertezza o errore resta la notifica, da verificare (e ritentata se possibile).
      const subitoCycle = await subitoRowsForEmails(
        subitoClassified.map(({ email }) => ({ email, digest: subitoDigestById.get(String(email.id))! })),
        supabaseSubitoDeps(ctx.supabaseAdmin, owner, fetchSubitoPage),
        {
          owner, classifySeller: (text: string) => classifySellerWithRegistry(text, sellerRegistry),
          // Schede singole «Da verificare» quando la novità non è dimostrabile: solo con
          // NMRE_SUBITO_ITEM_CANDIDATES=true, DOPO la migrazione 20261126210000 (nessuna
          // notifica per scheda). Senza la variabile il comportamento resta quello attuale.
          itemCandidates: subitoItemCandidatesEnabled(Deno.env.get("NMRE_SUBITO_ITEM_CANDIDATES"))
        }
      );
      rowFailures.push(...subitoCycle.failures);
      const subitoRows = subitoCycle.rows;
      const subitoOutcomes = subitoCycle.outcomes;
      const rows: any[] = [...regularRows, ...subitoRows];

      const counters = newSaveCounters();
      const promotedCandidateByEmail = new Map<string, string>();
      rowFailures.push(...await processRowsIsolated(rows, row => String(row.notification_source_id || row.source_email_id), async (row) => {
        const candidateId = await saveCandidateRow(ctx.supabaseAdmin, owner, row as unknown as CandidateRow, counters);
        if (forcedIds.has(row.source_email_id)) promotedCandidateByEmail.set(row.source_email_id, candidateId);
      }));
      const { inserted, updated, notificationEventsLinked, autoArchived, reopenedOnPriceDrop, notificationsAfterDiscard } = counters;
      // Nessun avanzamento del cursore se anche una sola email non è stata salvata.
      assertAllRowsSaved(rowFailures);

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
        syncMode, propertyFilterRules, keptForReview, reopenedOnPriceDrop, notificationsAfterDiscard, subitoOutcomes,
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
        subitoSavedSearches: subitoOutcomes,
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