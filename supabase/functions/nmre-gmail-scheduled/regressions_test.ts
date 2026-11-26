// Test di regressione dell'audit del 26/11/2026 (punti 1–5). Usano solo funzioni già
// presenti nella versione precedente, così falliscono sul codice di d524e4a e passano
// sul codice corretto.
import {
  appendStatusHistory, discardedNotificationAction, existingCandidatePatch, keptForReviewPatch, markDiscardedPatch,
  pendingNotificationsAfterDiscard, preserveStatusHistory, recordNotificationAfterDiscard, STATUS_HISTORY_LIMIT
} from "./_shared/retention.ts";
import type { ExistingCandidateRow } from "./_shared/retention.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
}
// deno-lint-ignore no-explicit-any
type Any = any;
const userDiscard = { data: "2026-11-20T10:00:00Z", origine: "utente", azione: "scartato", motivo: "Non interessa" };
const info = (data: string, id: string) => ({ data, source_email_id: id, prezzo: 180000, ribasso_percentuale: null, titolo: null, comune: null, portale: null, priceDropPercent: null });

// ---------- 1 · Storico ----------
Deno.test("1 · 'conservato_non_riconosciuto' registrato una sola volta per email, anche dopo 60 riletture", () => {
  let candidate: Any = { source_email_id: "m-old", deduplication_version: 0, data_extraction_version: 0, seller_classification_version: 0,
    dati_estratti: { storico_stato: [userDiscard] } };
  let writes = 0;
  for (let run = 0; run < 60; run++) {
    const patch = keptForReviewPatch(candidate, "nessun_link_annuncio", new Date(Date.UTC(2026, 10, 26, 10, run)).toISOString());
    if (patch) { candidate = { ...candidate, ...patch }; writes++; }
  }
  const history = candidate.dati_estratti.storico_stato as Any[];
  assertEquals(history.filter(e => e.azione === "conservato_non_riconosciuto").length, 1, "una sola voce automatica");
  assertEquals(history[0].azione, "scartato", "la decisione dell'utente resta nello storico");
  assertEquals(writes, 1, "le riletture successive non scrivono nulla");
});

Deno.test("1 · il limite dello storico non elimina mai le decisioni dell'utente", () => {
  let dati: Any = { storico_stato: [userDiscard, { data: "2026-11-21T10:00:00Z", origine: "utente", azione: "notifica_dopo_scarto_vista" }] };
  for (let index = 0; index < STATUS_HISTORY_LIMIT + 20; index++) {
    dati = appendStatusHistory(dati, { data: new Date(Date.UTC(2026, 10, 22, 0, index)).toISOString(), origine: "sincronizzazione", azione: "nuova_notifica_dopo_scarto", source_email_id: "n" + index });
  }
  const history = dati.storico_stato as Any[];
  assertEquals(history.length, STATUS_HISTORY_LIMIT, "limite rispettato");
  assertEquals(history.filter(e => e.origine === "utente").length, 2, "entrambe le decisioni dell'utente conservate");
  assertEquals(history[history.length - 1].source_email_id, "n" + (STATUS_HISTORY_LIMIT + 19), "le voci automatiche più recenti restano");
  const preserved = preserveStatusHistory(dati, { campi_immobile: {} }) as Any;
  assertEquals(preserved.storico_stato.filter((e: Any) => e.origine === "utente").length, 2, "anche una nuova estrazione conserva le decisioni dell'utente");
});

// ---------- 2 · Notifiche registrate dopo lo scarto o la presa visione ----------
Deno.test("2 · email inviata prima dello scarto ma registrata dopo: segnalata (contrassegno con elenco 'visti')", () => {
  // Scarto alle 10:00:30 dal nuovo frontend: le notifiche già presenti risultano viste.
  const atDiscard: Any = { storico_stato: [{ ...userDiscard, data: "2026-11-26T10:00:30Z" }],
    notifiche_dopo_scarto: { da_rivedere: false, visto_il: "2026-11-26T10:00:30Z", visti: ["a"], elenco: [info("2026-11-25T09:00:00Z", "a")] } };
  // Email inviata alle 10:00:00, elaborata dalla sincronizzazione alle 10:01.
  const after = markDiscardedPatch({ dati_estratti: atDiscard }, info("2026-11-26T10:00:00Z", "late"), "2026-11-26T10:01:00Z").dati_estratti;
  assertEquals(pendingNotificationsAfterDiscard(after, []), 1, "la notifica registrata dopo lo scarto è segnalata");
});

Deno.test("2 · contrassegno precedente senza 'visti': conta l'ora di registrazione, non la data dell'email", () => {
  const legacy: Any = { storico_stato: [{ ...userDiscard, data: "2026-11-26T10:00:30Z" }] };
  const after = markDiscardedPatch({ dati_estratti: legacy }, info("2026-11-26T10:00:00Z", "late"), "2026-11-26T10:01:00Z").dati_estratti;
  assertEquals(pendingNotificationsAfterDiscard(after, []), 1, "registrata alle 10:01, dopo lo scarto delle 10:00:30: segnalata");
});

Deno.test("2 · presa visione: tre notifiche viste e una sola nuova, anche se l'email è anteriore alla presa visione", () => {
  let dati: Any = { storico_stato: [userDiscard] };
  for (const [id, d] of [["a", "2026-11-21T09:00:00Z"], ["b", "2026-11-22T09:00:00Z"], ["c", "2026-11-23T09:00:00Z"]]) dati = recordNotificationAfterDiscard(dati, info(d, id));
  dati = { ...dati, notifiche_dopo_scarto: { ...dati.notifiche_dopo_scarto, da_rivedere: false, visto_il: "2026-11-24T10:00:30Z", visti: ["a", "b", "c"] } };
  assertEquals(pendingNotificationsAfterDiscard(dati, []), 0, "nessuna notifica nuova dopo la presa visione");
  const after = markDiscardedPatch({ dati_estratti: dati }, info("2026-11-24T10:00:00Z", "d"), "2026-11-24T10:01:00Z").dati_estratti;
  assertEquals(pendingNotificationsAfterDiscard(after, []), 1, "una sola notifica nuova");
});

// ---------- 3 e 4 · Riletture di email già gestite, senza confronto tra orologi ----------
Deno.test("3 · riapertura della versione precedente e scarto con il vecchio frontend: la rilettura non riapre", () => {
  const legacy = { storico_stato: [userDiscard, { data: "2026-11-24T09:00:05Z", origine: "sincronizzazione", azione: "riaperto_per_ribasso", motivo: "Nuovo ribasso documentato" }] };
  const action = discardedNotificationAction({ stato: "scartato", datiEstratti: legacy, sourceEmailId: "m1",
    knownNotificationCreatedAt: "2026-11-24T09:00:00Z", hasPriceDrop: true, currentPrice: 180000, lastRecordedPrice: null });
  assertEquals(action, "none", "lo scarto manuale prevale sulla rilettura della vecchia email");
});

Deno.test("4 · la decisione non dipende dagli orologi: email già registrata, orologio del dispositivo in ritardo", () => {
  // Scarto registrato dal telefono con l'orologio 10 minuti indietro: le date sembrano dire
  // che la notifica è successiva allo scarto, ma è una rilettura di un'email già registrata.
  const dati = { storico_stato: [{ ...userDiscard, data: "2026-11-26T09:50:00Z" }] };
  const action = discardedNotificationAction({ stato: "scartato", datiEstratti: dati, sourceEmailId: "m1",
    knownNotificationCreatedAt: "2026-11-26T09:55:00Z", hasPriceDrop: true, currentPrice: 170000, lastRecordedPrice: 180000 });
  assertEquals(action, "none", "una notifica già registrata non riapre mai l'annuncio");
  assertEquals(discardedNotificationAction({ stato: "scartato", datiEstratti: dati, sourceEmailId: "m2",
    knownNotificationCreatedAt: null, hasPriceDrop: true, currentPrice: 170000, lastRecordedPrice: 180000 }), "reopen", "una notifica mai registrata con nuovo ribasso riapre");
});

// ---------- 5 · Campi modificati a mano ----------
const emailRow = {
  titolo: "Titolo dall'email", comune: "Ancona", prezzo: 175000, notification_sender: "Portale", email_subject: "Nuovo prezzo",
  portale: "immobiliare.it", url: "https://www.immobiliare.it/annunci/1/", url_originale: null, data_pubblicazione: "2026-11-26T08:00:00Z",
  tipologia_immobile: "Appartamento", superficie_mq: 80, locali: 3, camere: 2, bagni: 1, dati_fonte: {},
  dati_estratti: { campi_immobile: { prezzo: 175000 } }, data_extraction_version: 6,
  tipo_venditore: "Da verificare", seller_confidence: 0, seller_evidence: "", seller_classification_version: 3
} as unknown as ExistingCandidateRow;
Deno.test("5 · la sincronizzazione non riscrive i campi corretti a mano", () => {
  const current = { stato: "da_verificare", seller_manual_override: false, tipo_venditore: "Da verificare", listing_key: "k1",
    dati_estratti: { campi_manuali: ["titolo", "prezzo", "superficie_mq"], storico_stato: [] } };
  const patch = existingCandidatePatch(current, emailRow, "2026-11-26T09:00:00Z");
  assertEquals("titolo" in patch, false, "titolo corretto a mano non riscritto");
  assertEquals("prezzo" in patch, false, "prezzo corretto a mano non riscritto");
  assertEquals("superficie_mq" in patch, false, "superficie corretta a mano non riscritta");
  assertEquals(patch.comune, "Ancona", "i campi non corretti a mano vengono aggiornati");
  assertEquals(JSON.stringify((patch.dati_estratti as Any).campi_manuali), '["titolo","prezzo","superficie_mq"]', "l'elenco dei campi manuali resta");
});
