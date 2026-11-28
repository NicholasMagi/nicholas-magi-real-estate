// Regole di conservazione delle opportunità (Fase 1 · "nessuna opportunità persa").
//
// Principio: un candidato non viene mai scartato automaticamente. Le decisioni
// automatiche possono soltanto conservare, annotare o riportare in revisione.
// Queste funzioni sono pure: non leggono né scrivono il database e sono coperte
// da retention_test.ts.

export const DATA_EXTRACTION_VERSION = 6;
export const SELLER_CLASSIFICATION_VERSION = 3;
export const STATUS_HISTORY_LIMIT = 50;

export type SellerType = "Privato" | "Da verificare" | "Agenzia";

export type SellerResult = {
  classification: SellerType;
  confidence: number;
  evidence: string;
};

export type RepairCandidate = {
  source_email_id?: unknown;
  seller_manual_override?: unknown;
  deduplication_version?: unknown;
  seller_classification_version?: unknown;
  data_extraction_version?: unknown;
};

/**
 * Replica il filtro storico di rielaborazione: un candidato in coda viene
 * riletto da Gmail finché una delle sue versioni è inferiore a quella attuale.
 */
/**
 * Riferimenti che NON sono email Gmail: le schede importate dal browser hanno
 * source_email_id "subito-browser:<lotto>#subito-<id>". Non vanno mai rilette da Gmail
 * (il riferimento non esiste come messaggio e la lettura fermerebbe la sincronizzazione).
 */
export function isNonGmailSourceReference(sourceEmailId: unknown): boolean {
  return typeof sourceEmailId === "string" && sourceEmailId.startsWith("subito-browser:");
}

export function isRepairEligible(candidate: RepairCandidate): boolean {
  if (typeof candidate.source_email_id !== "string" || !candidate.source_email_id) return false;
  if (isNonGmailSourceReference(candidate.source_email_id)) return false;
  if (candidate.seller_manual_override === true) return false;
  if (Number(candidate.deduplication_version || 0) < 1) return true;
  if (Number(candidate.seller_classification_version || 0) < SELLER_CLASSIFICATION_VERSION) return true;
  if (Number(candidate.data_extraction_version || 0) < DATA_EXTRACTION_VERSION) return true;
  return false;
}

/**
 * Versioni da scrivere su un candidato che è stato riletto ma i cui dati non
 * vengono aggiornati (copia storica di un immobile già rappresentato da un altro
 * candidato, oppure email non più riconosciuta come avviso). Segna il
 * candidato come "elaborato con la versione attuale", così non viene riletto a
 * ogni sincronizzazione. Non abbassa mai una versione esistente (per esempio la
 * versione 100 delle classificazioni manuali).
 */
export function processedVersionMark(candidate: RepairCandidate): Record<string, number> {
  return {
    deduplication_version: Math.max(1, Number(candidate.deduplication_version || 0)),
    data_extraction_version: Math.max(DATA_EXTRACTION_VERSION, Number(candidate.data_extraction_version || 0)),
    seller_classification_version: Math.max(SELLER_CLASSIFICATION_VERSION, Number(candidate.seller_classification_version || 0))
  };
}

/**
 * Campi venditore da applicare a un candidato già presente e ancora in coda.
 * - Le classificazioni manuali non vengono mai toccate (null).
 * - Un candidato non viene mai declassato automaticamente ad "Agenzia": i nuovi
 *   segnali di agenzia lo lasciano "Da verificare" con l'evidenza esplicita, così
 *   resta visibile nella coda principale per la revisione manuale.
 */
export function sellerFieldsForExisting(
  existing: { tipo_venditore?: unknown; seller_manual_override?: unknown },
  next: SellerResult
): { tipo_venditore: SellerType; seller_confidence: number; seller_evidence: string } | null {
  if (existing.seller_manual_override === true) return null;
  if (next.classification === "Agenzia" && existing.tipo_venditore !== "Agenzia") {
    return {
      tipo_venditore: "Da verificare",
      seller_confidence: 0,
      seller_evidence: ("Nuovi segnali di agenzia (" + next.evidence + "): conferma manuale necessaria").slice(0, 500)
    };
  }
  return {
    tipo_venditore: next.classification,
    seller_confidence: next.confidence,
    seller_evidence: next.evidence
  };
}

/** Dati necessari per decidere che cosa fare di una notifica su un candidato scartato. */
export type DiscardedNotificationInput = {
  /** Stato del candidato appena riletto dal database. */
  stato: unknown;
  /** dati_estratti del candidato appena riletto (storico delle decisioni e contrassegno). */
  datiEstratti: unknown;
  /** Identificativo dell'email Gmail della notifica (chiave dello storico notifiche). */
  sourceEmailId: string;
  /** created_at della notifica se era già nello storico prima di questa elaborazione; null se è nuova. */
  knownNotificationCreatedAt: string | null;
  hasPriceDrop: boolean;
  currentPrice: number | null;
  /** Ultimo prezzo già registrato per lo stesso candidato da un'altra notifica (null se nessuno). */
  lastRecordedPrice: number | null;
};

export type DiscardedNotificationAction = "reopen" | "mark" | "none";

function toTime(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}
function statusHistoryOf(datiEstratti: unknown): Array<Record<string, unknown>> {
  const base = datiEstratti && typeof datiEstratti === "object" && !Array.isArray(datiEstratti)
    ? datiEstratti as Record<string, unknown>
    : {};
  return Array.isArray(base.storico_stato) ? base.storico_stato as Array<Record<string, unknown>> : [];
}
function discardMarkerOf(datiEstratti: unknown): Record<string, unknown> | null {
  const base = datiEstratti && typeof datiEstratti === "object" && !Array.isArray(datiEstratti)
    ? datiEstratti as Record<string, unknown>
    : {};
  const marker = base.notifiche_dopo_scarto;
  return marker && typeof marker === "object" && !Array.isArray(marker) ? marker as Record<string, unknown> : null;
}

export const DISCARD_ACTIONS = ["scartato", "classificato_agenzia_e_scartato"];
export const SEEN_ACTION = "notifica_dopo_scarto_vista";

/** Data (ms) dell'ultimo scarto registrato nello storico; null per gli scarti senza storico. */
export function lastDiscardTime(datiEstratti: unknown): number | null {
  const history = statusHistoryOf(datiEstratti);
  for (let index = history.length - 1; index >= 0; index--) {
    if (DISCARD_ACTIONS.includes(String(history[index]?.azione))) return toTime(history[index]?.data);
  }
  return null;
}

/**
 * Riferimento della revisione delle notifiche dopo lo scarto: il più recente tra
 * l'ultimo scarto, la presa visione registrata nel contrassegno (visto_il) e l'ultima
 * voce di storico "notifica_dopo_scarto_vista" (copre i contrassegni storici in cui
 * visto_il è andato perso). Le notifiche arrivate prima di questo istante non sono
 * "nuove". La stessa regola è implementata nel frontend (index.html,
 * nmreNotificationsAfterDiscard) e i test verificano che coincidano.
 */
export function notificationReviewReference(datiEstratti: unknown): number | null {
  const times: number[] = [];
  const discard = lastDiscardTime(datiEstratti);
  if (discard !== null) times.push(discard);
  const seen = toTime(discardMarkerOf(datiEstratti)?.visto_il);
  if (seen !== null) times.push(seen);
  const history = statusHistoryOf(datiEstratti);
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index]?.azione === SEEN_ACTION) {
      const time = toTime(history[index]?.data);
      if (time !== null) times.push(time);
      break;
    }
  }
  return times.length ? Math.max(...times) : null;
}

/**
 * Notifiche del contrassegno ancora da guardare. Regola principale, senza orologi:
 * sono nuove le voci la cui email non è nell'elenco "visti" (scritto dal frontend alla
 * presa visione e allo scarto). Per i contrassegni precedenti, senza "visti", vale la
 * regola temporale: la voce è nuova se registrata (registrata_il, ora del server; in
 * mancanza la data dell'email) dopo il riferimento (ultimo scarto o presa visione).
 * Stessa logica di nmreNotificationsAfterDiscard nel frontend, verificata dai test.
 */
export function pendingMarkerEntries(datiEstratti: unknown): Array<Record<string, unknown>> {
  const marker = discardMarkerOf(datiEstratti);
  if (!marker) return [];
  const list = Array.isArray(marker.elenco) ? marker.elenco as Array<Record<string, unknown>> : [];
  const reference = notificationReviewReference(datiEstratti);
  const registeredAfterReference = (entry: Record<string, unknown>) => {
    const time = toTime(entry?.registrata_il) ?? toTime(entry?.data);
    return reference === null || time === null || time > reference;
  };
  if (Array.isArray(marker.visti)) {
    // Per identificativo; le voci senza identificativo (dati precedenti) si confrontano
    // con l'ora di registrazione, altrimenti resterebbero "nuove" per sempre.
    const seen = new Set((marker.visti as unknown[]).map(String));
    return list.filter(entry => {
      const id = String(entry?.source_email_id ?? "");
      return id ? !seen.has(id) : registeredAfterReference(entry);
    });
  }
  if (marker.da_rivedere !== true) return [];
  return list.filter(registeredAfterReference);
}

/**
 * Numero di notifiche da evidenziare come "nuove dopo lo scarto". Con il contrassegno
 * della sincronizzazione vale solo il contrassegno (identificativi delle email); lo
 * storico notifiche, confrontato con l'ora di registrazione (created_at, del database),
 * serve solo per gli scarti senza contrassegno.
 */
export function pendingNotificationsAfterDiscard(
  datiEstratti: unknown,
  notificationHistory: Array<{ notified_at?: unknown; created_at?: unknown }>
): number {
  const marker = discardMarkerOf(datiEstratti);
  if (marker) {
    const pending = pendingMarkerEntries(datiEstratti).length;
    const list = Array.isArray(marker.elenco) ? marker.elenco : [];
    return pending || (marker.da_rivedere === true && !list.length ? 1 : 0);
  }
  const reference = notificationReviewReference(datiEstratti);
  if (reference === null) return 0;
  return notificationHistory.filter(entry => {
    const time = toTime(entry?.created_at) ?? toTime(entry?.notified_at);
    return time !== null && time > reference;
  }).length;
}

/** La notifica è già stata gestita su questo candidato (riapertura o contrassegno). */
export function notificationAlreadyHandled(datiEstratti: unknown, sourceEmailId: string): boolean {
  if (!sourceEmailId) return false;
  const history = statusHistoryOf(datiEstratti);
  if (history.some(entry => entry && entry.source_email_id === sourceEmailId)) return true;
  const marker = discardMarkerOf(datiEstratti);
  const list = marker && Array.isArray(marker.elenco) ? marker.elenco as Array<Record<string, unknown>> : [];
  return list.some(entry => entry && entry.source_email_id === sourceEmailId);
}

/**
 * Che cosa fare di una notifica su un candidato scartato. Nessun confronto tra orologi:
 * - "none": il candidato non è scartato, oppure la notifica è già stata gestita, oppure
 *   l'email era già registrata nello storico notifiche prima di questa elaborazione
 *   (rilettura, comprese le email gestite dalle versioni precedenti della funzione):
 *   la decisione dell'utente prevale. La funzione scrive la decisione PRIMA di
 *   registrare la notifica, quindi una notifica registrata è sempre già stata valutata.
 * - "reopen": notifica mai registrata con un ribasso NUOVO (prezzo inferiore all'ultimo
 *   prezzo già registrato).
 * - "mark": notifica mai registrata senza un nuovo ribasso: resta scartato ma viene
 *   evidenziato nel pannello di recupero.
 */
export function discardedNotificationAction(input: DiscardedNotificationInput): DiscardedNotificationAction {
  if (input.stato !== "scartato") return "none";
  if (notificationAlreadyHandled(input.datiEstratti, input.sourceEmailId)) return "none";
  if (input.knownNotificationCreatedAt !== null && input.knownNotificationCreatedAt !== undefined) return "none";
  const newPriceDrop = input.hasPriceDrop === true && input.currentPrice !== null &&
    (input.lastRecordedPrice === null || input.currentPrice < input.lastRecordedPrice);
  return newPriceDrop ? "reopen" : "mark";
}

/** Un annuncio scartato torna in revisione solo per una notifica nuova con un nuovo ribasso. */
export function shouldReopenDiscarded(input: DiscardedNotificationInput): boolean {
  return discardedNotificationAction(input) === "reopen";
}

export type StatusHistoryEntry = {
  data: string;
  origine: "sincronizzazione" | "utente";
  azione: string;
  da?: string | null;
  a?: string | null;
  motivo?: string | null;
  regola?: string | null;
  /** Email che ha causato la voce (riapertura o nuova notifica): evita doppie elaborazioni. */
  source_email_id?: string | null;
};

/**
 * Aggiunge una voce allo storico delle decisioni conservato in
 * dati_estratti.storico_stato, senza rimuovere alcun altro campo. Restituisce un
 * nuovo oggetto; mantiene al massimo STATUS_HISTORY_LIMIT voci, le più recenti.
 */
export function appendStatusHistory(
  datiEstratti: unknown,
  entry: StatusHistoryEntry
): Record<string, unknown> {
  const base = datiEstratti && typeof datiEstratti === "object" && !Array.isArray(datiEstratti)
    ? { ...(datiEstratti as Record<string, unknown>) }
    : {};
  const previous = Array.isArray(base.storico_stato) ? base.storico_stato : [];
  const clean: StatusHistoryEntry = {
    ...entry,
    motivo: entry.motivo ? String(entry.motivo).slice(0, 300) : entry.motivo ?? null
  };
  base.storico_stato = trimStatusHistory([...previous, clean]);
  return base;
}

/**
 * Applica il limite di STATUS_HISTORY_LIMIT voci eliminando per prime le voci
 * automatiche più vecchie. Le decisioni dell'utente (origine "utente") non vengono mai
 * eliminate, anche se da sole superano il limite.
 */
export function trimStatusHistory(history: unknown[]): unknown[] {
  if (history.length <= STATUS_HISTORY_LIMIT) return history;
  let excess = history.length - STATUS_HISTORY_LIMIT;
  const keep = history.map(() => true);
  for (let index = 0; index < history.length && excess > 0; index++) {
    const entry = history[index] as Record<string, unknown> | null;
    if (entry && entry.origine === "utente") continue;
    keep[index] = false;
    excess--;
  }
  return history.filter((_, index) => keep[index]);
}

/**
 * Chiavi di dati_estratti che non provengono dall'estrazione dell'email e che una
 * nuova estrazione non deve cancellare: lo storico delle decisioni, il contrassegno
 * delle notifiche dopo lo scarto e i dati della pagina pubblica salvati dal frontend.
 */
export const PRESERVED_EXTRACTED_KEYS = ["storico_stato", "notifiche_dopo_scarto", "pagina_pubblica", "campi_manuali"];

/** Campi dell'annuncio che l'utente può correggere a mano e che la sincronizzazione aggiorna. */
export const MANUALLY_EDITABLE_FIELDS = ["titolo", "comune", "prezzo", "tipologia_immobile", "superficie_mq", "locali", "camere", "bagni"];

/** Campi modificati a mano dall'utente (dati_estratti.campi_manuali, scritto dal frontend). */
export function manualFields(datiEstratti: unknown): Set<string> {
  const base = datiEstratti && typeof datiEstratti === "object" && !Array.isArray(datiEstratti)
    ? datiEstratti as Record<string, unknown>
    : {};
  return new Set(Array.isArray(base.campi_manuali) ? (base.campi_manuali as unknown[]).map(String) : []);
}

/**
 * Conserva i dati già presenti quando una nuova estrazione sostituisce dati_estratti:
 * le chiavi di PRESERVED_EXTRACTED_KEYS restano quelle del record (l'estrazione
 * dell'email non le produce); tutto il resto viene dalla nuova estrazione.
 */
export function preserveStatusHistory(
  previousDatiEstratti: unknown,
  nextDatiEstratti: Record<string, unknown>
): Record<string, unknown> {
  const previous = previousDatiEstratti && typeof previousDatiEstratti === "object" && !Array.isArray(previousDatiEstratti)
    ? previousDatiEstratti as Record<string, unknown>
    : {};
  let result: Record<string, unknown> = nextDatiEstratti;
  for (const key of PRESERVED_EXTRACTED_KEYS) {
    const value = previous[key];
    if (value === undefined || value === null) continue;
    if (key === "storico_stato") {
      if (!Array.isArray(value) || !value.length) continue;
      result = { ...result, storico_stato: trimStatusHistory(value) };
    } else {
      result = { ...result, [key]: value };
    }
  }
  return result;
}

/** Le email di agenzia vengono conservate (recuperabili) salvo disattivazione esplicita. */
export function keepAgencyCandidates(envValue: string | undefined): boolean {
  return String(envValue ?? "").trim().toLowerCase() !== "false";
}

export const DISCARDED_NOTIFICATION_LIMIT = 10;

export type DiscardedNotificationInfo = {
  data: string;
  /** Ora in cui NMRE ha registrato la notifica (server), indipendente dalla data dell'email. */
  registrata_il?: string | null;
  source_email_id: string;
  prezzo: number | null;
  ribasso_percentuale: number | null;
  titolo: string | null;
  comune: string | null;
  portale: string | null;
};

/**
 * Una notifica è "nuova dopo lo scarto" quando arriva per un candidato scartato e
 * non era già registrata nello storico (non è una semplice rilettura).
 */
export function isNewNotificationAfterDiscard(existingStato: unknown, alreadyRecorded: boolean): boolean {
  return existingStato === "scartato" && alreadyRecorded !== true;
}

/**
 * Registra in dati_estratti.notifiche_dopo_scarto le informazioni essenziali di
 * una nuova notifica arrivata su un candidato scartato (senza testi dell'email):
 * conteggio, ultima notifica ed elenco delle più recenti. Restituisce un nuovo oggetto.
 */
export function recordNotificationAfterDiscard(
  datiEstratti: unknown,
  info: DiscardedNotificationInfo
): Record<string, unknown> {
  const base = datiEstratti && typeof datiEstratti === "object" && !Array.isArray(datiEstratti)
    ? { ...(datiEstratti as Record<string, unknown>) }
    : {};
  const previous = base.notifiche_dopo_scarto && typeof base.notifiche_dopo_scarto === "object" &&
      !Array.isArray(base.notifiche_dopo_scarto)
    ? base.notifiche_dopo_scarto as Record<string, unknown>
    : {};
  const list = Array.isArray(previous.elenco) ? previous.elenco as DiscardedNotificationInfo[] : [];
  if (list.some(item => item && item.source_email_id === info.source_email_id)) return base;
  const clean: DiscardedNotificationInfo = {
    ...info,
    titolo: info.titolo ? String(info.titolo).slice(0, 250) : null,
    comune: info.comune ? String(info.comune).slice(0, 120) : null,
    portale: info.portale ? String(info.portale).slice(0, 80) : null
  };
  // Gli altri campi del contrassegno (per esempio visto_il della presa visione) restano.
  base.notifiche_dopo_scarto = {
    ...previous,
    conteggio: Number(previous.conteggio || 0) + 1,
    ultima: clean,
    elenco: [...list, clean].slice(-DISCARDED_NOTIFICATION_LIMIT),
    da_rivedere: true
  };
  return base;
}

/** Prezzo e dati essenziali di una notifica, per le modifiche dei candidati scartati. */
export type DiscardedNotificationPatchInfo = DiscardedNotificationInfo & { priceDropPercent: number | null };

/** Modifica per riaprire un candidato scartato (da applicare con un aggiornamento protetto). */
export function reopenDiscardedPatch(current: { dati_estratti?: unknown }, info: DiscardedNotificationPatchInfo, nowIso: string) {
  return {
    stato: "da_verificare",
    dati_estratti: appendStatusHistory(current.dati_estratti, {
      data: nowIso,
      origine: "sincronizzazione",
      azione: "riaperto_per_ribasso",
      da: "scartato",
      a: "da_verificare",
      source_email_id: info.source_email_id,
      motivo: "Nuovo ribasso documentato" + (info.priceDropPercent !== null ? " (-" + info.priceDropPercent + "%)" : "")
    }),
    updated_at: nowIso
  };
}

/** Modifica per evidenziare una nuova notifica su un candidato che resta scartato. */
export function markDiscardedPatch(current: { dati_estratti?: unknown }, info: DiscardedNotificationPatchInfo, nowIso: string) {
  const { priceDropPercent: _priceDropPercent, ...notice } = info;
  const marked = recordNotificationAfterDiscard(current.dati_estratti, { ...notice, registrata_il: nowIso });
  return {
    dati_estratti: appendStatusHistory(marked, {
      data: nowIso,
      origine: "sincronizzazione",
      azione: "nuova_notifica_dopo_scarto",
      source_email_id: info.source_email_id,
      motivo: "Nuova notifica dello stesso immobile dopo lo scarto"
    }),
    updated_at: nowIso
  };
}

/**
 * Modifica per un candidato riletto la cui email non è più riconosciuta come avviso.
 * Idempotente: la voce di storico viene registrata una sola volta per email; alle
 * riletture successive si aggiornano solo i segni tecnici, se necessario (altrimenti
 * null: nessuna scrittura).
 */
export function keptForReviewPatch(
  current: RepairCandidate & { dati_estratti?: unknown },
  rule: string,
  nowIso: string,
  sourceEmailId: string | null = typeof current.source_email_id === "string" ? current.source_email_id : null
): Record<string, unknown> | null {
  const marks = processedVersionMark(current);
  const already = statusHistoryOf(current.dati_estratti).some(entry =>
    entry && entry.azione === "conservato_non_riconosciuto" && (sourceEmailId === null || entry.source_email_id === sourceEmailId || entry.source_email_id === undefined));
  if (already) {
    const changed = (Object.keys(marks) as Array<keyof typeof marks>).some(key => Number((current as Record<string, unknown>)[key] || 0) !== marks[key]);
    return changed ? marks : null;
  }
  return {
    ...marks,
    dati_estratti: appendStatusHistory(current.dati_estratti, {
      data: nowIso,
      origine: "sincronizzazione",
      azione: "conservato_non_riconosciuto",
      regola: rule,
      source_email_id: sourceEmailId,
      motivo: "Email riletta e non più riconosciuta come avviso: il candidato resta nel suo stato per la revisione manuale"
    }),
    updated_at: nowIso
  };
}

/** Campi della notifica usati per aggiornare un candidato esistente. */
export type ExistingCandidateRow = {
  titolo: unknown; comune: unknown; prezzo: unknown; notification_sender: unknown; email_subject: unknown;
  portale: unknown; url: unknown; url_originale: unknown; data_pubblicazione: unknown; tipologia_immobile: unknown;
  superficie_mq: unknown; locali: unknown; camere: unknown; bagni: unknown; dati_fonte: unknown;
  dati_estratti: Record<string, unknown>; data_extraction_version: unknown; tipo_venditore: SellerType;
  seller_confidence: number; seller_evidence: string; seller_classification_version: unknown; listing_key?: unknown;
};

/**
 * Modifica di un candidato già presente quando arriva una sua notifica, calcolata dal
 * valore APPENA RILETTO del candidato (aggiornamento protetto): un candidato in coda
 * riceve i dati della nuova estrazione conservando lo storico delle decisioni; la
 * classificazione manuale non viene mai toccata; nessun declassamento ad "Agenzia".
 * Gli scartati e gli archiviati non vengono aggiornati qui.
 */
export function existingCandidatePatch(
  current: { stato?: unknown; seller_manual_override?: unknown; tipo_venditore?: unknown; dati_estratti?: unknown; listing_key?: unknown },
  row: ExistingCandidateRow,
  nowIso: string
): Record<string, unknown> {
  const patch: Record<string, unknown> = { deduplication_version: 1, updated_at: nowIso };
  if (current.stato === "da_verificare") {
    const manual = manualFields(current.dati_estratti);
    Object.assign(patch, {
      titolo: row.titolo, comune: row.comune, prezzo: row.prezzo,
      notification_sender: row.notification_sender, email_subject: row.email_subject,
      portale: row.portale, url: row.url, url_originale: row.url_originale,
      data_pubblicazione: row.data_pubblicazione, tipologia_immobile: row.tipologia_immobile,
      superficie_mq: row.superficie_mq, locali: row.locali, camere: row.camere, bagni: row.bagni,
      dati_fonte: row.dati_fonte,
      dati_estratti: preserveStatusHistory(current.dati_estratti, row.dati_estratti),
      data_extraction_version: row.data_extraction_version
    });
    // I campi corretti a mano dall'utente non vengono riscritti dalla nuova email.
    for (const field of manual) if (MANUALLY_EDITABLE_FIELDS.includes(field)) delete patch[field];
    const sellerFields = sellerFieldsForExisting(current, {
      classification: row.tipo_venditore, confidence: row.seller_confidence, evidence: row.seller_evidence
    });
    if (sellerFields) Object.assign(patch, sellerFields, { seller_classification_version: row.seller_classification_version });
  }
  if (row.listing_key && !current.listing_key) patch.listing_key = row.listing_key;
  return patch;
}
