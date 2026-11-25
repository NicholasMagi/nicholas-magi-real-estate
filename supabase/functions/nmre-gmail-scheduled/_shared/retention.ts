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
export function isRepairEligible(candidate: RepairCandidate): boolean {
  if (typeof candidate.source_email_id !== "string" || !candidate.source_email_id) return false;
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

/** Un annuncio scartato in passato torna in revisione quando arriva un ribasso documentato. */
export function shouldReopenDiscarded(existingStato: unknown, hasPriceDrop: boolean): boolean {
  return existingStato === "scartato" && hasPriceDrop === true;
}

export type StatusHistoryEntry = {
  data: string;
  origine: "sincronizzazione" | "utente";
  azione: string;
  da?: string | null;
  a?: string | null;
  motivo?: string | null;
  regola?: string | null;
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
  base.storico_stato = [...previous, clean].slice(-STATUS_HISTORY_LIMIT);
  return base;
}

/**
 * Conserva i dati già estratti quando una nuova estrazione sostituisce
 * dati_estratti: lo storico delle decisioni non deve andare perso.
 */
export function preserveStatusHistory(
  previousDatiEstratti: unknown,
  nextDatiEstratti: Record<string, unknown>
): Record<string, unknown> {
  const previous = previousDatiEstratti && typeof previousDatiEstratti === "object" && !Array.isArray(previousDatiEstratti)
    ? previousDatiEstratti as Record<string, unknown>
    : {};
  if (!Array.isArray(previous.storico_stato) || !previous.storico_stato.length) return nextDatiEstratti;
  return { ...nextDatiEstratti, storico_stato: previous.storico_stato.slice(-STATUS_HISTORY_LIMIT) };
}

/** Le email di agenzia vengono conservate (recuperabili) salvo disattivazione esplicita. */
export function keepAgencyCandidates(envValue: string | undefined): boolean {
  return String(envValue ?? "").trim().toLowerCase() !== "false";
}

export const DISCARDED_NOTIFICATION_LIMIT = 10;

export type DiscardedNotificationInfo = {
  data: string;
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
  base.notifiche_dopo_scarto = {
    conteggio: Number(previous.conteggio || 0) + 1,
    ultima: clean,
    elenco: [...list, clean].slice(-DISCARDED_NOTIFICATION_LIMIT),
    da_rivedere: true
  };
  return base;
}
