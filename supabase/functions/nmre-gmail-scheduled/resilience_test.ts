// Punto 6 · Un'email problematica non blocca le altre e il cursore non avanza finché
// tutte le email non sono state salvate; la ripetizione non produce duplicati.
import { assertAllRowsSaved, IncompleteSyncError, processRowsIsolated } from "./_shared/row_isolation.ts";
import { keptForReviewPatch, markDiscardedPatch, pendingNotificationsAfterDiscard } from "./_shared/retention.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
}
// deno-lint-ignore no-explicit-any
type Any = any;

// Ciclo simulato con la stessa sequenza di index.ts: elaborazione isolata, verifica,
// poi salvataggio del cursore.
async function runCycle(rows: string[], saved: Map<string, number>, poison: Set<string>, cursor: { value: string }, next: string) {
  const failures = await processRowsIsolated(rows, id => id, async (id) => {
    if (poison.has(id)) throw new Error("errore persistente su " + id);
    saved.set(id, (saved.get(id) || 0) + 1);
  });
  assertAllRowsSaved(failures);
  cursor.value = next;
}

Deno.test("6 · un'email problematica non impedisce di salvare le altre; il cursore non avanza", async () => {
  const saved = new Map<string, number>();
  const cursor = { value: "h100" };
  let error: unknown = null;
  try { await runCycle(["a", "bad", "c"], saved, new Set(["bad"]), cursor, "h200"); } catch (e) { error = e; }
  assertEquals(error instanceof IncompleteSyncError, true, "elaborazione incompleta segnalata");
  assertEquals((error as IncompleteSyncError).failures.map(f => f.sourceEmailId).join(","), "bad", "l'email non salvata è indicata");
  assertEquals(saved.has("a") && saved.has("c"), true, "le altre email sono state salvate");
  assertEquals(cursor.value, "h100", "il cursore Gmail non è avanzato");
  // Ciclo successivo: arrivano nuove email; quella problematica blocca ancora il cursore,
  // ma le nuove vengono acquisite.
  try { await runCycle(["a", "bad", "c", "d"], saved, new Set(["bad"]), cursor, "h300"); } catch { /* atteso */ }
  assertEquals(saved.has("d"), true, "le nuove email vengono acquisite nonostante l'email problematica");
  assertEquals(cursor.value, "h100", "il cursore resta fermo finché l'email problematica non è salvata");
  // Il problema si risolve: il cursore avanza.
  await runCycle(["a", "bad", "c", "d"], saved, new Set(), cursor, "h400");
  assertEquals(cursor.value, "h400", "cursore avanzato solo quando tutte le email sono salvate");
});

Deno.test("6 · le ripetizioni dovute a un'email problematica non duplicano storico e contrassegni", () => {
  let candidate: Any = { source_email_id: "m1", deduplication_version: 1, data_extraction_version: 6, seller_classification_version: 3,
    dati_estratti: { storico_stato: [{ data: "2026-11-20T10:00:00Z", origine: "utente", azione: "scartato" }] } };
  for (let run = 0; run < 10; run++) {
    const kept = keptForReviewPatch(candidate, "nessun_link_annuncio", new Date(Date.UTC(2026, 10, 26, 11, run)).toISOString());
    if (kept) candidate = { ...candidate, ...kept };
    candidate = { ...candidate, ...markDiscardedPatch(candidate, { data: "2026-11-26T10:00:00Z", source_email_id: "m2", prezzo: 1, ribasso_percentuale: null, titolo: null, comune: null, portale: null, priceDropPercent: null }, new Date(Date.UTC(2026, 10, 26, 11, run)).toISOString()) };
  }
  const history = candidate.dati_estratti.storico_stato as Any[];
  assertEquals(history.filter(e => e.azione === "conservato_non_riconosciuto").length, 1, "una sola voce 'conservato'");
  assertEquals(candidate.dati_estratti.notifiche_dopo_scarto.elenco.length, 1, "una sola voce nel contrassegno");
  assertEquals(pendingNotificationsAfterDiscard(candidate.dati_estratti, []), 1, "una sola notifica da guardare");
  assertEquals(history[0].azione, "scartato", "decisione dell'utente conservata");
});
