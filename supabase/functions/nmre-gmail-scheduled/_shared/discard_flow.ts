// Notifica su un candidato già esistente: riapertura per nuovo ribasso, contrassegno di
// nuova notifica o nessuna modifica. Usata da index.ts e dai test (stesso codice).
import { discardedNotificationAction, markDiscardedPatch, reopenDiscardedPatch } from "./retention.ts";
import type { DiscardedNotificationAction, DiscardedNotificationPatchInfo } from "./retention.ts";
import { guardedCandidateUpdate } from "./guarded.ts";
import type { GuardedClient } from "./guarded.ts";

export type DiscardedNotificationContext = {
  candidateId: string;
  /** created_at della notifica se già presente nello storico PRIMA di questa elaborazione; null se nuova. */
  knownNotificationCreatedAt: string | null;
  hasPriceDrop: boolean;
  currentPrice: number | null;
  lastRecordedPrice: number | null;
  info: DiscardedNotificationPatchInfo;
};

export type DiscardedNotificationOutcome = { action: DiscardedNotificationAction; written: boolean };

/**
 * La decisione è presa sul candidato appena riletto e la scrittura è protetta da
 * updated_at: una modifica dell'utente avvenuta nel frattempo (nuovo scarto, recupero,
 * presa visione) non viene sovrascritta e la decisione viene ricalcolata.
 */
export async function applyNotificationToExistingCandidate(
  admin: GuardedClient,
  owner: string,
  context: DiscardedNotificationContext,
  now: () => string = () => new Date().toISOString()
): Promise<DiscardedNotificationOutcome> {
  const decision: { action: DiscardedNotificationAction } = { action: "none" };
  const result = await guardedCandidateUpdate<{ stato?: unknown; dati_estratti?: unknown; updated_at?: unknown }>(
    admin, owner, context.candidateId, "id,stato,dati_estratti,updated_at",
    (current) => {
      decision.action = discardedNotificationAction({
        stato: current.stato,
        datiEstratti: current.dati_estratti,
        sourceEmailId: context.info.source_email_id,
        knownNotificationCreatedAt: context.knownNotificationCreatedAt,
        hasPriceDrop: context.hasPriceDrop,
        currentPrice: context.currentPrice,
        lastRecordedPrice: context.lastRecordedPrice
      });
      if (decision.action === "reopen") return reopenDiscardedPatch(current, context.info, now());
      if (decision.action === "mark") return markDiscardedPatch(current, context.info, now());
      return null;
    });
  if (result.status === "error") throw new Error("Aggiornamento del candidato scartato non riuscito");
  return { action: decision.action, written: result.status === "updated" };
}
