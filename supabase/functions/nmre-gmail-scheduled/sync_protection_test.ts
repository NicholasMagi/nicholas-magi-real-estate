// Test della protezione delle opportunità nella sincronizzazione Gmail:
//  B1 · una stessa notifica non riapre più volte un annuncio scartato;
//  B2 · conteggio delle notifiche dopo la presa visione (visto_il conservato);
//  B3 · nessuna modifica manuale sovrascritta da una scrittura concorrente.
// La decisione e la scrittura usano il codice di produzione
// (applyNotificationToExistingCandidate, guardedCandidateUpdate, existingCandidatePatch,
// keptForReviewPatch); il database è simulato in memoria.
import { applyNotificationToExistingCandidate } from "./_shared/discard_flow.ts";
import { CandidateWriteConflict, guardedCandidateUpdate, GUARDED_MAX_ATTEMPTS } from "./_shared/guarded.ts";
import {
  existingCandidatePatch, keptForReviewPatch, notificationReviewReference, pendingNotificationsAfterDiscard,
  recordNotificationAfterDiscard
} from "./_shared/retention.ts";
import type { ExistingCandidateRow } from "./_shared/retention.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
}

// ---------- Database simulato (solo annunci_candidati) ----------
type Row = {
  id: string; owner_id: string; updated_at: string | null;
  // deno-lint-ignore no-explicit-any
  stato?: any; tipo_venditore?: any; seller_manual_override?: any; dati_estratti?: any; listing_key?: any;
  // deno-lint-ignore no-explicit-any
  deduplication_version?: any; data_extraction_version?: any; seller_classification_version?: any; [key: string]: any;
};
function fakeDb(rows: Row[]) {
  const state = { rows, writes: 0, rejectedWrites: 0, afterRead: null as null | ((row: Row) => void) };
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 26, 12, 0, 0) + (++tick) * 1000).toISOString();
  const client = {
    from(_table: string) {
      const q: { filters: Array<(row: Row) => boolean>; op: string; patch?: Record<string, unknown>; single: boolean; cols: string } =
        { filters: [], op: "select", single: false, cols: "*" };
      const builder: Record<string, unknown> = {
        select(cols: string) { if (q.op === "select") q.cols = cols; return builder; },
        eq(column: string, value: unknown) { q.filters.push(row => String(row[column]) === String(value)); return builder; },
        is(column: string, value: unknown) { q.filters.push(row => (row[column] ?? null) === value); return builder; },
        maybeSingle() { q.single = true; return builder; },
        update(patch: Record<string, unknown>) { q.op = "update"; q.patch = patch; return builder; },
        then(resolve: (value: unknown) => void) {
          const matching = state.rows.filter(row => q.filters.every(filter => filter(row)));
          if (q.op === "update") {
            if (matching.length) { matching.forEach(row => Object.assign(row, structuredClone(q.patch))); state.writes++; }
            else state.rejectedWrites++;
            resolve({ data: matching.map(row => ({ id: row.id })), error: null });
            return;
          }
          const data = q.single ? (matching[0] ? structuredClone(matching[0]) : null) : structuredClone(matching);
          // Modifica concorrente simulata: avviene dopo la lettura e prima della scrittura.
          if (q.single && matching[0] && state.afterRead) state.afterRead(matching[0]);
          resolve({ data, error: null });
        }
      };
      return builder;
    }
  };
  return { client, state, stamp };
}

// Azioni dell'utente nel frontend (stessa forma delle scritture di index.html).
function userDiscard(row: Row, at: string) {
  const history = Array.isArray((row.dati_estratti as Record<string, unknown>)?.storico_stato) ? (row.dati_estratti as Record<string, unknown[]>).storico_stato : [];
  row.stato = "scartato";
  row.dati_estratti = { ...(row.dati_estratti as Record<string, unknown>), storico_stato: [...history, { data: at, origine: "utente", azione: "scartato", motivo: "Non interessa" }] };
  row.updated_at = at;
}
function userSeen(row: Row, at: string) {
  const de = row.dati_estratti as Record<string, unknown>;
  const marker = (de.notifiche_dopo_scarto || {}) as Record<string, unknown>;
  const history = Array.isArray(de.storico_stato) ? de.storico_stato as unknown[] : [];
  row.dati_estratti = { ...de, notifiche_dopo_scarto: { ...marker, da_rivedere: false, visto_il: at },
    storico_stato: [...history, { data: at, origine: "utente", azione: "notifica_dopo_scarto_vista" }] };
  row.updated_at = at;
}

// ---------- B1 · sincronizzazione simulata di una notifica ----------
// Riproduce l'ordine di index.ts: notifica già nota (created_at) → ultimo prezzo registrato
// da un'altra notifica → ribasso (dichiarato o storico, max 50%) → registrazione della
// notifica (l'upsert conserva created_at) → decisione e scrittura protetta (codice reale).
type Notice = { created_at: string; price: number };
async function syncEmail(world: ReturnType<typeof fakeDb>, notices: Map<string, Notice>, email: { id: string; price: number; declaredPrevious?: number }) {
  const known = notices.get(email.id)?.created_at ?? null;
  const others = [...notices.entries()].filter(([id]) => id !== email.id).sort((a, b) => b[1].created_at.localeCompare(a[1].created_at));
  const lastRecordedPrice = others.length ? others[0][1].price : null;
  let previousPrice: number | null = email.declaredPrevious ?? null;
  if (previousPrice === null && lastRecordedPrice !== null && lastRecordedPrice > email.price && (lastRecordedPrice - email.price) / lastRecordedPrice <= 0.5) previousPrice = lastRecordedPrice;
  const hasPriceDrop = previousPrice !== null && previousPrice > email.price;
  if (!known) notices.set(email.id, { created_at: world.stamp(), price: email.price });
  return await applyNotificationToExistingCandidate(world.client, "u1", {
    candidateId: "c1", knownNotificationCreatedAt: known, hasPriceDrop, currentPrice: email.price, lastRecordedPrice,
    info: { data: world.stamp(), source_email_id: email.id, prezzo: email.price, ribasso_percentuale: null, titolo: "Trilocale", comune: "Ancona", portale: "immobiliare.it", priceDropPercent: null }
  }, world.stamp);
}
const row = () => ({ id: "c1", owner_id: "u1", stato: "scartato", tipo_venditore: "Da verificare", seller_manual_override: false,
  updated_at: "2026-11-20T10:00:00.000Z", dati_estratti: { pagina_pubblica: { evidenza: "pagina" },
    storico_stato: [{ data: "2026-11-20T10:00:00.000Z", origine: "utente", azione: "scartato" }] } } as Row);
const historyLength = (r: Row) => ((r.dati_estratti as Record<string, unknown[]>).storico_stato || []).length;

Deno.test("B1 · la stessa notifica non riapre più volte un annuncio scartato", async () => {
  const world = fakeDb([row()]);
  const notices = new Map<string, Notice>([["m0", { created_at: "2026-11-15T00:00:00.000Z", price: 200000 }]]);
  const r = world.state.rows[0];
  // 1. Nuova email con ribasso dichiarato (200.000 → 180.000): riapre
  assertEquals((await syncEmail(world, notices, { id: "m1", price: 180000, declaredPrevious: 200000 })).action, "reopen", "nuova notifica con nuovo ribasso: riapertura");
  assertEquals(r.stato, "da_verificare", "candidato riaperto");
  // 2. L'utente lo scarta di nuovo
  userDiscard(r, world.stamp());
  const afterDiscard = historyLength(r);
  // 3. Riletture ripetute della stessa email (per esempio sincronizzazione completa a 30 giorni)
  for (let i = 0; i < 3; i++) {
    const outcome = await syncEmail(world, notices, { id: "m1", price: 180000, declaredPrevious: 200000 });
    assertEquals(outcome.action, "none", "rilettura " + (i + 1) + " della stessa email: nessuna azione");
  }
  assertEquals(r.stato, "scartato", "la decisione di scarto dell'utente resta");
  assertEquals(historyLength(r), afterDiscard, "nessuna voce di storico aggiunta dalle riletture");
  // 4. Nuova email distinta allo stesso prezzo (nessun nuovo ribasso): evidenziata, resta scartato
  assertEquals((await syncEmail(world, notices, { id: "m2", price: 180000, declaredPrevious: 200000 })).action, "mark", "nuova email con lo stesso ribasso già noto: contrassegno, nessuna riapertura");
  assertEquals(r.stato, "scartato", "resta scartato");
  assertEquals((await syncEmail(world, notices, { id: "m2", price: 180000, declaredPrevious: 200000 })).action, "none", "rilettura della nuova email: nessuna azione");
  // 5. Nuova email distinta con un nuovo ribasso: riapre
  assertEquals((await syncEmail(world, notices, { id: "m3", price: 170000 })).action, "reopen", "nuova email con nuovo ribasso (180.000 → 170.000): riapertura");
  assertEquals(r.stato, "da_verificare", "riaperto per il nuovo ribasso");
  const reopens = ((r.dati_estratti as Record<string, Array<Record<string, unknown>>>).storico_stato).filter(e => e.azione === "riaperto_per_ribasso");
  assertEquals(reopens.map(e => e.source_email_id).join(","), "m1,m3", "ogni riapertura registra l'email che l'ha causata, una sola volta");
});

Deno.test("B1 · riaperture registrate prima della correzione (senza email nello storico)", async () => {
  // Riapertura della versione precedente (nessun source_email_id), poi nuovo scarto dell'utente.
  const legacy = row();
  (legacy.dati_estratti as Record<string, unknown[]>).storico_stato.push(
    { data: "2026-11-21T09:00:00.000Z", origine: "sincronizzazione", azione: "riaperto_per_ribasso" },
    { data: "2026-11-22T09:00:00.000Z", origine: "utente", azione: "scartato" });
  const world = fakeDb([legacy]);
  const notices = new Map<string, Notice>([["m0", { created_at: "2026-11-15T00:00:00.000Z", price: 200000 }], ["m1", { created_at: "2026-11-21T08:59:00.000Z", price: 180000 }]]);
  assertEquals((await syncEmail(world, notices, { id: "m1", price: 180000, declaredPrevious: 200000 })).action, "none", "email già acquisita prima dell'ultimo scarto: nessuna riapertura");
  assertEquals(world.state.rows[0].stato, "scartato", "resta scartato");
});

Deno.test("B1 · elaborazione interrotta tra notifica e riapertura: la riapertura avviene alla ripetizione", async () => {
  const world = fakeDb([row()]);
  // La notifica è stata registrata DOPO l'ultimo scarto ma la riapertura non è avvenuta.
  const notices = new Map<string, Notice>([["m0", { created_at: "2026-11-15T00:00:00.000Z", price: 200000 }], ["m1", { created_at: "2026-11-25T08:00:00.000Z", price: 180000 }]]);
  assertEquals((await syncEmail(world, notices, { id: "m1", price: 180000, declaredPrevious: 200000 })).action, "reopen", "notifica acquisita dopo lo scarto e non gestita: riapertura");
});

// ---------- B2 · presa visione ----------
const notice = (id: string, data: string) => ({ data, source_email_id: id, prezzo: 1, ribasso_percentuale: null, titolo: null, comune: null, portale: null });
Deno.test("B2 · tre notifiche viste e una sola nuova: una sola notifica nuova, visto_il conservato", () => {
  let de: Record<string, unknown> = { storico_stato: [{ data: "2026-11-10T10:00:00Z", origine: "utente", azione: "scartato" }] };
  for (const [id, d] of [["a", "2026-11-12T09:00:00Z"], ["b", "2026-11-13T09:00:00Z"], ["c", "2026-11-14T09:00:00Z"]]) de = recordNotificationAfterDiscard(de, notice(id, d));
  const r = { id: "x", owner_id: "u1", updated_at: null, dati_estratti: de } as Row;
  userSeen(r, "2026-11-15T10:00:00Z");
  const history = [{ notified_at: "2026-11-12T09:00:00Z" }, { notified_at: "2026-11-13T09:00:00Z" }, { notified_at: "2026-11-14T09:00:00Z" }];
  assertEquals(pendingNotificationsAfterDiscard(r.dati_estratti, history), 0, "dopo la presa visione nessuna notifica nuova");
  const after = recordNotificationAfterDiscard(r.dati_estratti, notice("d", "2026-11-20T09:00:00Z")) as Record<string, Record<string, unknown>>;
  assertEquals(after.notifiche_dopo_scarto.visto_il, "2026-11-15T10:00:00Z", "visto_il conservato dalla ricostruzione del contrassegno");
  assertEquals(after.notifiche_dopo_scarto.da_rivedere, true, "il contrassegno si riattiva");
  assertEquals(pendingNotificationsAfterDiscard(after, [...history, { notified_at: "2026-11-20T09:00:00Z" }]), 1, "una sola notifica nuova dopo la presa visione");
});

Deno.test("B2 · contrassegni storici senza visto_il ma con la voce di presa visione", () => {
  const de = {
    storico_stato: [{ data: "2026-11-10T10:00:00Z", origine: "utente", azione: "scartato" },
      { data: "2026-11-15T10:00:00Z", origine: "utente", azione: "notifica_dopo_scarto_vista" }],
    // visto_il perso dalla versione precedente della funzione
    notifiche_dopo_scarto: { conteggio: 4, da_rivedere: true, elenco: [notice("a", "2026-11-12T09:00:00Z"), notice("b", "2026-11-13T09:00:00Z"), notice("c", "2026-11-14T09:00:00Z"), notice("d", "2026-11-20T09:00:00Z")] }
  };
  assertEquals(notificationReviewReference(de), Date.parse("2026-11-15T10:00:00Z"), "riferimento dalla voce di storico");
  assertEquals(pendingNotificationsAfterDiscard(de, []), 1, "solo la notifica successiva alla presa visione");
});

// ---------- B3 · modifiche manuali tra lettura e scrittura della funzione ----------
const emailRow: ExistingCandidateRow = {
  titolo: "Trilocale aggiornato", comune: "Ancona", prezzo: 175000, notification_sender: "Portale", email_subject: "Nuovo prezzo",
  portale: "immobiliare.it", url: "https://www.immobiliare.it/annunci/1/", url_originale: null, data_pubblicazione: "2026-11-26T08:00:00Z",
  tipologia_immobile: "Appartamento", superficie_mq: 90, locali: 3, camere: 2, bagni: 1, dati_fonte: {},
  dati_estratti: { campi_immobile: { prezzo: 175000 } }, data_extraction_version: 6,
  tipo_venditore: "Agenzia", seller_confidence: 90, seller_evidence: "segnali di agenzia", seller_classification_version: 3
};
const queued = () => ({ id: "c1", owner_id: "u1", stato: "da_verificare", tipo_venditore: "Da verificare", seller_manual_override: false,
  listing_key: "k1", updated_at: "2026-11-26T09:00:00.000Z",
  dati_estratti: { pagina_pubblica: { evidenza: "pagina analizzata" }, storico_stato: [{ data: "2026-11-25T10:00:00Z", origine: "utente", azione: "riportato_in_revisione" }] } } as Row);
const COLUMNS = "id,stato,seller_manual_override,tipo_venditore,dati_estratti,listing_key,updated_at";

Deno.test("B3 · classificazione manuale salvata durante la sincronizzazione: non sovrascritta", async () => {
  const world = fakeDb([queued()]);
  world.state.afterRead = r => {
    world.state.afterRead = null;
    r.tipo_venditore = "Privato"; r.seller_manual_override = true; r.seller_evidence = "Verificato manualmente: venditore privato";
    r.dati_estratti = { ...(r.dati_estratti as Record<string, unknown>), storico_stato: [...(r.dati_estratti as Record<string, unknown[]>).storico_stato, { data: "2026-11-26T09:00:01Z", origine: "utente", azione: "classificazione_manuale", a: "Privato" }] };
    r.updated_at = "2026-11-26T09:00:01.000Z";
  };
  const result = await guardedCandidateUpdate(world.client, "u1", "c1", COLUMNS, (current: Row) => existingCandidatePatch(current, emailRow, world.stamp()));
  const r = world.state.rows[0];
  assertEquals(result.status, "updated", "aggiornamento riuscito dopo la rilettura");
  assertEquals(result.attempts, 2, "il primo tentativo è stato respinto dal controllo su updated_at");
  assertEquals(world.state.rejectedWrites, 1, "una scrittura respinta");
  assertEquals(r.tipo_venditore, "Privato", "classificazione manuale conservata");
  assertEquals(r.seller_manual_override, true, "decisione manuale conservata");
  assertEquals(((r.dati_estratti as Record<string, Array<Record<string, unknown>>>).storico_stato).at(-1)?.azione, "classificazione_manuale", "voce di storico dell'utente conservata");
  assertEquals(((r.dati_estratti as Record<string, Record<string, unknown>>).pagina_pubblica).evidenza, "pagina analizzata", "dati della pagina pubblica conservati");
  assertEquals(r.prezzo, 175000, "informazioni della nuova email applicate");
});

Deno.test("B3 · senza modifiche concorrenti: un solo tentativo e nessun declassamento ad agenzia", async () => {
  const world = fakeDb([queued()]);
  const result = await guardedCandidateUpdate(world.client, "u1", "c1", COLUMNS, (current: Row) => existingCandidatePatch(current, emailRow, world.stamp()));
  assertEquals(result.attempts, 1, "un solo tentativo");
  assertEquals(world.state.rows[0].tipo_venditore, "Da verificare", "segnali di agenzia: resta Da verificare");
  assertEquals(((world.state.rows[0].dati_estratti as Record<string, unknown[]>).storico_stato).length, 1, "storico conservato");
});

Deno.test("B3 · presa visione durante la registrazione di una nuova notifica: conservata", async () => {
  const start = row();
  start.dati_estratti = recordNotificationAfterDiscard(start.dati_estratti, notice("a", "2026-11-21T09:00:00Z"));
  const world = fakeDb([start]);
  world.state.afterRead = r => { world.state.afterRead = null; userSeen(r, "2026-11-26T11:59:59.000Z"); };
  const notices = new Map<string, Notice>([["a", { created_at: "2026-11-21T09:00:00.000Z", price: 200000 }]]);
  const outcome = await syncEmail(world, notices, { id: "b", price: 200000 });
  const marker = (world.state.rows[0].dati_estratti as Record<string, Record<string, unknown>>).notifiche_dopo_scarto;
  assertEquals(outcome.action, "mark", "nuova notifica evidenziata");
  assertEquals(marker.visto_il, "2026-11-26T11:59:59.000Z", "presa visione conservata");
  assertEquals(((world.state.rows[0].dati_estratti as Record<string, Array<Record<string, unknown>>>).storico_stato).some(e => e.azione === "notifica_dopo_scarto_vista"), true, "voce di presa visione conservata");
  assertEquals(pendingNotificationsAfterDiscard(world.state.rows[0].dati_estratti, []), 1, "una sola notifica nuova");
});

Deno.test("B3 · annuncio recuperato dall'utente durante la sincronizzazione: nessuna riapertura né sovrascrittura", async () => {
  const world = fakeDb([row()]);
  world.state.afterRead = r => {
    world.state.afterRead = null;
    r.stato = "da_verificare";
    r.dati_estratti = { ...(r.dati_estratti as Record<string, unknown>), storico_stato: [...(r.dati_estratti as Record<string, unknown[]>).storico_stato, { data: "2026-11-26T11:59:59Z", origine: "utente", azione: "riportato_in_revisione" }] };
    r.updated_at = "2026-11-26T11:59:59.000Z";
  };
  const notices = new Map<string, Notice>([["m0", { created_at: "2026-11-15T00:00:00.000Z", price: 200000 }]]);
  const outcome = await syncEmail(world, notices, { id: "m1", price: 180000, declaredPrevious: 200000 });
  assertEquals(outcome.action, "none", "dopo la rilettura il candidato non è più scartato: nessuna azione");
  assertEquals(outcome.written, false, "operazione non conteggiata come eseguita: nessun record aggiornato");
  assertEquals(((world.state.rows[0].dati_estratti as Record<string, Array<Record<string, unknown>>>).storico_stato).at(-1)?.azione, "riportato_in_revisione", "decisione dell'utente conservata");
});

Deno.test("B3 · voce 'conservato_non_riconosciuto' e modifica concorrente: entrambe le voci restano", async () => {
  const world = fakeDb([queued()]);
  world.state.afterRead = r => { world.state.afterRead = null; userDiscard(r, "2026-11-26T09:00:02.000Z"); };
  const result = await guardedCandidateUpdate(world.client, "u1", "c1",
    "id,dati_estratti,deduplication_version,data_extraction_version,seller_classification_version,updated_at",
    (current: Row) => keptForReviewPatch(current, "nessun_link_annuncio", world.stamp()));
  const actions = ((world.state.rows[0].dati_estratti as Record<string, Array<Record<string, unknown>>>).storico_stato).map(e => e.azione).join(",");
  assertEquals(result.status, "updated", "aggiornamento riuscito");
  assertEquals(actions, "riportato_in_revisione,scartato,conservato_non_riconosciuto", "voce dell'utente e voce della sincronizzazione entrambe presenti");
  assertEquals(world.state.rows[0].stato, "scartato", "lo scarto dell'utente resta");
});

Deno.test("B3 · conflitto persistente: nessuna scrittura e interruzione controllata", async () => {
  const world = fakeDb([queued()]);
  let edits = 0;
  const keepEditing = (r: Row) => { edits++; r.updated_at = "2026-11-26T09:00:0" + edits + ".000Z"; world.state.afterRead = keepEditing; };
  world.state.afterRead = keepEditing;
  let thrown: unknown = null;
  try { await guardedCandidateUpdate(world.client, "u1", "c1", COLUMNS, (current: Row) => existingCandidatePatch(current, emailRow, world.stamp())); }
  catch (error) { thrown = error; }
  assertEquals(thrown instanceof CandidateWriteConflict, true, "conflitto segnalato (il cursore Gmail non avanza)");
  assertEquals(world.state.writes, 0, "nessuna scrittura applicata");
  assertEquals(world.state.rejectedWrites, GUARDED_MAX_ATTEMPTS, "tentativi limitati a " + GUARDED_MAX_ATTEMPTS);
  assertEquals(world.state.rows[0].prezzo, undefined, "dati dell'utente intatti");
});

Deno.test("B3 · conflitto persistente durante la riapertura, poi rielaborazione: una sola riapertura, nessun duplicato", async () => {
  const world = fakeDb([row()]);
  const notices = new Map<string, Notice>([["m0", { created_at: "2026-11-15T00:00:00.000Z", price: 200000 }]]);
  const r = world.state.rows[0];
  const historyBefore = historyLength(r);
  // L'utente modifica il candidato a ogni tentativo: il conflitto non si risolve.
  let edits = 0;
  const keepEditing = (target: Row) => { edits++; target.updated_at = "2026-11-26T11:00:0" + edits + ".000Z"; world.state.afterRead = keepEditing; };
  world.state.afterRead = keepEditing;
  let thrown: unknown = null;
  try { await syncEmail(world, notices, { id: "m1", price: 180000, declaredPrevious: 200000 }); } catch (error) { thrown = error; }
  assertEquals(thrown instanceof CandidateWriteConflict, true, "conflitto persistente: errore recuperabile (il ciclo si interrompe, il cursore non avanza)");
  assertEquals(r.stato, "scartato", "conflitto persistente: nessuna riapertura scritta");
  assertEquals(historyLength(r), historyBefore, "conflitto persistente: nessuna voce di storico scritta");
  // Ciclo successivo: la stessa email viene rielaborata (il cursore non era avanzato).
  world.state.afterRead = null;
  assertEquals((await syncEmail(world, notices, { id: "m1", price: 180000, declaredPrevious: 200000 })).action, "reopen", "rielaborazione: la riapertura avviene una volta");
  assertEquals((await syncEmail(world, notices, { id: "m1", price: 180000, declaredPrevious: 200000 })).action, "none", "ulteriore rilettura: nessuna azione");
  const reopens = ((r.dati_estratti as Record<string, Array<Record<string, unknown>>>).storico_stato).filter(e => e.azione === "riaperto_per_ribasso");
  assertEquals(reopens.length, 1, "una sola voce di riapertura nello storico");
  assertEquals(notices.size, 2, "nessuna notifica duplicata (chiave owner_id + source_email_id)");
});
