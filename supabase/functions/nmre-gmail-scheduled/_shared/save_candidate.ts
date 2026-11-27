// Salvataggio di una riga (un immobile di una notifica) nella coda dei candidati.
// Logica spostata da index.ts senza modifiche di comportamento per le email normali; in
// più, per gli annunci recuperati da una ricerca salvata Subito:
//  - notification_source_id: identificativo della notifica (email + annuncio), perché una
//    sola email Subito produce più notifiche;
//  - preserve_existing: un annuncio già presente non viene riscritto (nessuna modifica
//    manuale o dato esistente sovrascritto), si registra solo la nuova notifica;
//  - ricerca dell'annuncio già acquisito anche per ID Subito (oltre alla listing_key).
// Per gli annunci Subito (ricerca salvata, intera ricerca, importazione da browser):
//  - history_only: un annuncio GIÀ presente non viene modificato in alcun modo (nessun
//    campo, nemmeno vuoto; nessuno stato; nessuna riapertura o contrassegno degli
//    scartati, nemmeno per un ribasso; nessun segno tecnico): solo lo storico notifiche;
//  - sighting_only: un annuncio ritrovato nella ricerca non è una nuova notifica; lo storico
//    si aggiorna solo se il prezzo è cambiato rispetto all'ultimo registrato;
//  - skip_auto_archive: le nuove schede restano in Nuove opportunità (nessuna archiviazione
//    automatica, decide il titolare).
import { existingCandidatePatch, processedVersionMark } from "./retention.ts";
import type { DiscardedNotificationPatchInfo, ExistingCandidateRow } from "./retention.ts";
import { guardedCandidateUpdate } from "./guarded.ts";
import type { GuardedClient } from "./guarded.ts";
import { applyNotificationToExistingCandidate } from "./discard_flow.ts";
import { subitoAdIdFromListingKey, subitoIdLikePatterns } from "./subito.ts";

export type SaveCounters = {
  inserted: number; updated: number; notificationEventsLinked: number; autoArchived: number;
  autoArchiveErrors: number; reopenedOnPriceDrop: number; notificationsAfterDiscard: number;
  /** Annunci ritrovati senza novità (nessuna notifica registrata). */
  sightingsWithoutChanges?: number;
};
export function newSaveCounters(): SaveCounters {
  return { inserted: 0, updated: 0, notificationEventsLinked: 0, autoArchived: 0, autoArchiveErrors: 0, reopenedOnPriceDrop: 0, notificationsAfterDiscard: 0 };
}

const CANDIDATE_COLUMNS = "id,seller_manual_override,stato,listing_key,tipo_venditore,dati_estratti,deduplication_version,data_extraction_version,seller_classification_version";
const INTERNAL_FIELDS = ["explicit_price_reduction", "notification_source_id", "subito_ad_id", "preserve_existing", "history_only", "sighting_only", "skip_auto_archive"];

// deno-lint-ignore no-explicit-any
export type SaveClient = GuardedClient & { rpc(name: string, params: Record<string, unknown>): any };

// deno-lint-ignore no-explicit-any
export type CandidateRow = Record<string, any> & { owner_id: string; source_email_id: string; dedup_key: string };

/** Restituisce l'id del candidato a cui è stata collegata la notifica. */
export async function saveCandidateRow(
  admin: SaveClient,
  owner: string,
  row: CandidateRow,
  counters: SaveCounters,
  now: () => string = () => new Date().toISOString()
): Promise<string> {
  const notificationId = String(row.notification_source_id || row.source_email_id);
  const { data: currentCandidate, error: currentError } = await admin
    .from("annunci_candidati")
    .select(CANDIDATE_COLUMNS)
    .eq("owner_id", owner)
    .eq("dedup_key", row.dedup_key)
    .maybeSingle();
  if (currentError) throw new Error("Verifica della notifica Gmail già registrata non riuscita");

  // deno-lint-ignore no-explicit-any
  let canonicalCandidate: any = null;
  if (row.listing_key) {
    const { data, error } = await admin
      .from("annunci_candidati")
      .select(CANDIDATE_COLUMNS)
      .eq("owner_id", owner)
      .eq("listing_key", row.listing_key)
      .maybeSingle();
    if (error) throw new Error("Ricerca dell'immobile già acquisito non riuscita");
    canonicalCandidate = data;
  }
  // Annunci Subito: stesso ID anche se il titolo nell'URL è cambiato.
  const subitoId = row.subito_ad_id || subitoAdIdFromListingKey(row.listing_key);
  // Anche senza titolo nell'URL (/<categoria>/<id>.htm).
  if (!canonicalCandidate && subitoId && /^\d{6,}$/.test(String(subitoId))) {
    for (const pattern of subitoIdLikePatterns(String(subitoId)).listingKey) {
      const { data, error } = await admin
        .from("annunci_candidati")
        .select(CANDIDATE_COLUMNS)
        .eq("owner_id", owner)
        .like("listing_key", pattern)
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) throw new Error("Ricerca dell'annuncio Subito già acquisito non riuscita");
      canonicalCandidate = Array.isArray(data) ? data[0] || null : data;
      if (canonicalCandidate) break;
    }
  }

  const existingCandidate = canonicalCandidate || currentCandidate;
  let candidateId: string | null = null;

  if (existingCandidate) {
    candidateId = String(existingCandidate.id);
    if (row.history_only) {
      // Annuncio Subito già presente: nessuna scrittura sulla scheda (né sulla copia storica).
    } else if (row.preserve_existing) {
      // Annuncio già presente: nessun dato riscritto. Solo la chiave dell'immobile, se manca.
      if (row.listing_key && !existingCandidate.listing_key) {
        const keyResult = await guardedCandidateUpdate(admin, owner, candidateId, "id,listing_key,updated_at",
          // deno-lint-ignore no-explicit-any
          (current: any) => current.listing_key ? null : { listing_key: row.listing_key, updated_at: now() });
        if (keyResult.status === "error" && keyResult.error.code !== "23505") throw new Error("Aggiornamento della chiave dell'immobile non riuscito");
      }
    } else {
      // Aggiornamento protetto: la modifica è calcolata dal candidato appena riletto
      // (stato, classificazione manuale, storico, dati della pagina) e scritta solo se
      // il record non è cambiato nel frattempo. Gli scartati e gli archiviati
      // ricevono solo i segni tecnici; la notifica resta nello storico e la decisione
      // su ribassi e nuove notifiche viene presa più avanti.
      const existingResult = await guardedCandidateUpdate(admin, owner, candidateId,
        "id,stato,seller_manual_override,tipo_venditore,dati_estratti,listing_key,updated_at",
        // deno-lint-ignore no-explicit-any
        (current: any) => existingCandidatePatch(current, row as unknown as ExistingCandidateRow, now()));
      const updateError = existingResult.status === "error" ? existingResult.error : null;
      if (existingResult.status === "missing") throw new Error("Il candidato da aggiornare non esiste più");
      if (updateError) {
        // Un altro ciclo potrebbe aver associato la stessa scheda nello stesso istante.
        if (updateError.code !== "23505") throw new Error("Aggiornamento dell'immobile candidato non riuscito");
        if (row.listing_key) {
          const { data: raced, error: raceError } = await admin
            .from("annunci_candidati").select("id").eq("owner_id", owner).eq("listing_key", row.listing_key).maybeSingle();
          if (raceError || !raced) throw new Error("Conflitto durante la deduplicazione dell'immobile");
          candidateId = String(raced.id);
        }
      } else if (existingResult.status === "updated") {
        counters.updated++;
      }
    }

    // La riga email legacy (copia storica dello stesso immobile) resta intatta nei dati,
    // ma viene marcata con le versioni attuali: senza questo segno resterebbe idonea alla
    // rielaborazione e verrebbe riletta da Gmail a ogni sincronizzazione.
    if (!row.history_only && currentCandidate && String(currentCandidate.id) !== candidateId) {
      const legacyMark = await guardedCandidateUpdate(admin, owner, String(currentCandidate.id),
        "id,deduplication_version,data_extraction_version,seller_classification_version,updated_at",
        // deno-lint-ignore no-explicit-any
        (current: any) => processedVersionMark(current));
      if (legacyMark.status === "error") throw new Error("Aggiornamento dello stato di deduplicazione non riuscito");
    }
  } else {
    // I campi interni non sono colonne del database.
    const candidateInsert: Record<string, unknown> = { ...row };
    for (const field of INTERNAL_FIELDS) delete candidateInsert[field];
    const { data: saved, error: insertError } = await admin
      .from("annunci_candidati")
      .insert(candidateInsert)
      .select("id")
      .maybeSingle();

    if (insertError) {
      if (insertError.code !== "23505") throw new Error("Salvataggio dell'immobile candidato non riuscito");
      // deno-lint-ignore no-explicit-any
      let raced: any = null;
      if (row.listing_key) {
        const { data, error } = await admin
          .from("annunci_candidati").select("id").eq("owner_id", owner).eq("listing_key", row.listing_key).maybeSingle();
        if (error) throw new Error("Verifica del duplicato concorrente non riuscita");
        raced = data;
      }
      if (!raced) {
        const { data, error } = await admin
          .from("annunci_candidati").select("id").eq("owner_id", owner).eq("dedup_key", row.dedup_key).maybeSingle();
        if (error || !data) throw new Error("Impossibile recuperare l'immobile salvato durante la deduplicazione");
        raced = data;
      }
      candidateId = String(raced.id);
      counters.updated++;
    } else {
      if (!saved?.id) throw new Error("Il database non ha restituito l'identificativo del candidato salvato");
      candidateId = String(saved.id);
      counters.inserted++;
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
    const { data: priorSnapshot, error: priorSnapshotError } = await admin
      .from("annunci_candidati_notifiche")
      .select("listing_price")
      .eq("owner_id", owner)
      .eq("candidate_id", candidateId)
      .neq("source_email_id", notificationId)
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
  // Annuncio ritrovato nella ricerca senza un prezzo diverso dall'ultimo registrato:
  // non è una nuova notifica (nessuna riapertura, nessun segno sulle schede scartate).
  if (row.sighting_only && existingCandidate && !(currentPrice !== null && lastRecordedPrice !== null && currentPrice !== lastRecordedPrice)) {
    counters.sightingsWithoutChanges = (counters.sightingsWithoutChanges || 0) + 1;
    return candidateId;
  }
  const hasPriceDrop = currentPrice !== null && previousPrice !== null && previousPrice > currentPrice;
  const priceDropAmount = hasPriceDrop ? Number(previousPrice) - currentPrice : null;
  const priceDropPercent = hasPriceDrop
    ? Math.round((priceDropAmount! / previousPrice!) * 10000) / 100
    : null;

  // Per un candidato già esistente serve sapere se la notifica era già acquisita
  // (rilettura della stessa email): lo storico notifiche è la fonte affidabile
  // (chiave owner_id + source_email_id).
  let knownNotificationCreatedAt: string | null = null;
  if (existingCandidate) {
    const { data: knownNotification, error: knownNotificationError } = await admin
      .from("annunci_candidati_notifiche")
      .select("source_email_id,created_at")
      .eq("owner_id", owner)
      .eq("source_email_id", notificationId)
      .maybeSingle();
    if (knownNotificationError) throw new Error("Verifica dello storico notifiche non riuscita");
    // Una notifica già registrata senza data viene trattata come molto vecchia (nessuna riapertura).
    knownNotificationCreatedAt = knownNotification ? String(knownNotification.created_at || "1970-01-01T00:00:00Z") : null;
  }

  // La decisione viene scritta PRIMA di registrare la notifica: una notifica già
  // registrata è sempre già stata valutata, quindi una rilettura (anche dopo
  // un'interruzione) non può ripetere una riapertura o un contrassegno.
  // Annunci Subito già presenti: nessuna riapertura né contrassegno degli scartati (anche
  // per un ribasso); il nuovo prezzo resta registrato soltanto nello storico qui sotto.
  if (existingCandidate && !row.history_only) {
    const patchInfo: DiscardedNotificationPatchInfo = {
      data: row.data_pubblicazione || now(),
      source_email_id: notificationId,
      prezzo: currentPrice,
      ribasso_percentuale: priceDropPercent,
      titolo: row.titolo,
      comune: row.comune,
      portale: row.portale,
      priceDropPercent
    };
    const outcome = await applyNotificationToExistingCandidate(admin, owner, {
      candidateId, knownNotificationCreatedAt, hasPriceDrop, currentPrice, lastRecordedPrice, info: patchInfo
    }, now);
    if (outcome.written && outcome.action === "reopen") counters.reopenedOnPriceDrop++;
    if (outcome.written && outcome.action === "mark") counters.notificationsAfterDiscard++;
  }

  const { error: notificationError } = await admin
    .from("annunci_candidati_notifiche")
    .upsert({
      owner_id: owner,
      candidate_id: candidateId,
      source_email_id: notificationId,
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
  counters.notificationEventsLinked++;

  // Archivia solo i privati con prova esplicita ad alta affidabilita o verifica manuale gia salvata.
  // Mai su un annuncio Subito già presente (history_only): archiviarlo lo modificherebbe.
  if (row.tipo_venditore === "Privato" && !row.skip_auto_archive && !(row.history_only && existingCandidate)) {
    const { data: archiveResult, error: archiveError } = await admin
      .rpc("nmre_auto_archive_private_candidate", { p_candidate_id: candidateId });
    // Non bloccante: il candidato è già salvato e resta in coda per l'archiviazione manuale.
    if (archiveError) counters.autoArchiveErrors++;
    else if (archiveResult?.archived === true) counters.autoArchived++;
  }
  return candidateId;
}
