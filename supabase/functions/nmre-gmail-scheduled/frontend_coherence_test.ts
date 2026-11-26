// Coerenza tra frontend e funzione di sincronizzazione sul conteggio delle notifiche
// dopo lo scarto: la funzione del pannello (index.html, nmreNotificationsAfterDiscard)
// e pendingNotificationsAfterDiscard (_shared/retention.ts) devono dare lo stesso
// risultato sugli stessi dati. Richiede: deno test --allow-read
import { pendingNotificationsAfterDiscard, recordNotificationAfterDiscard } from "./_shared/retention.ts";

const html = await Deno.readTextFile(new URL("../../../index.html", import.meta.url));
function grab(name: string): string {
  let start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  if (html.slice(start - 6, start) === "async ") start -= 6;
  let depth = 0;
  for (let index = html.indexOf("){", start) + 1; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}
const frontend = new Function(
  'const NMRE_DISCARD_ACTIONS=["scartato","classificato_agenzia_e_scartato"];' +
  ["nmreTime", "nmreDiscardEntry", "nmreLastSeenEntry", "nmreNotificationsAfterDiscard"].map(grab).join("\n") +
  ";return nmreNotificationsAfterDiscard;"
)() as (item: unknown) => { count: number };

const notice = (id: string, data: string) => ({ data, source_email_id: id, prezzo: 1, ribasso_percentuale: null, titolo: null, comune: null, portale: null });
const discard = (data: string) => ({ data, origine: "utente", azione: "scartato" });
const seen = (data: string) => ({ data, origine: "utente", azione: "notifica_dopo_scarto_vista" });
const at = (iso: string) => ({ notified_at: iso });

type Fixture = { name: string; dati: Record<string, unknown>; history: Array<{ notified_at: string }>; expected: number };
function seenMarker(dati: Record<string, unknown>, when: string, keepVistoIl = true) {
  const marker = dati.notifiche_dopo_scarto as Record<string, unknown>;
  return { ...dati, notifiche_dopo_scarto: { ...marker, da_rivedere: false, ...(keepVistoIl ? { visto_il: when } : {}) },
    storico_stato: [...(dati.storico_stato as unknown[]), seen(when)] };
}
let three: Record<string, unknown> = { storico_stato: [discard("2026-11-10T10:00:00Z")] };
for (const [id, d] of [["a", "2026-11-12T09:00:00Z"], ["b", "2026-11-13T09:00:00Z"], ["c", "2026-11-14T09:00:00Z"]]) three = recordNotificationAfterDiscard(three, notice(id, d));
const threeSeen = seenMarker(three, "2026-11-15T10:00:00Z");
const oneAfterSeen = recordNotificationAfterDiscard(threeSeen, notice("d", "2026-11-20T09:00:00Z"));
const legacyLost = recordNotificationAfterDiscard(seenMarker(three, "2026-11-15T10:00:00Z", false), notice("d", "2026-11-20T09:00:00Z"));
const threeHistory = [at("2026-11-12T09:00:00Z"), at("2026-11-13T09:00:00Z"), at("2026-11-14T09:00:00Z")];
const fixtures: Fixture[] = [
  { name: "tre notifiche dopo lo scarto, non viste", dati: three, history: threeHistory, expected: 3 },
  { name: "tre notifiche viste", dati: threeSeen, history: threeHistory, expected: 0 },
  { name: "tre viste e una nuova (visto_il conservato)", dati: oneAfterSeen, history: [...threeHistory, at("2026-11-20T09:00:00Z")], expected: 1 },
  { name: "tre viste e una nuova (contrassegno storico senza visto_il)", dati: legacyLost, history: [...threeHistory, at("2026-11-20T09:00:00Z")], expected: 1 },
  { name: "secondo scarto dopo le notifiche", dati: { ...three, storico_stato: [...(three.storico_stato as unknown[]), { data: "2026-11-16T00:00:00Z", origine: "utente", azione: "riportato_in_revisione" }, discard("2026-11-18T00:00:00Z")] }, history: threeHistory, expected: 0 },
  { name: "scarto senza storico, contrassegno con due voci", dati: { notifiche_dopo_scarto: { da_rivedere: true, elenco: [notice("x", "2026-11-01T00:00:00Z"), notice("y", "2026-11-02T00:00:00Z")] } }, history: [], expected: 2 },
  { name: "contrassegno attivo senza elenco", dati: { notifiche_dopo_scarto: { da_rivedere: true } }, history: [], expected: 1 },
  { name: "nessun contrassegno e nessuno scarto registrato", dati: {}, history: [at("2026-11-24T00:00:00Z")], expected: 0 }
];

for (const fixture of fixtures) {
  Deno.test("coerenza frontend/sincronizzazione · " + fixture.name, () => {
    const backend = pendingNotificationsAfterDiscard(fixture.dati, fixture.history);
    const front = frontend({ dati_estratti: fixture.dati, notification_history: fixture.history }).count;
    if (backend !== fixture.expected) throw new Error("retention.ts: " + backend + ", atteso " + fixture.expected);
    if (front !== fixture.expected) throw new Error("index.html: " + front + ", atteso " + fixture.expected);
  });
}
