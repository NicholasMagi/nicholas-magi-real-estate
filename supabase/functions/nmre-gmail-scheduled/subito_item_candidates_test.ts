// Schede singole «Da verificare» per gli annunci Subito con novità non dimostrata
// (NMRE_SUBITO_ITEM_CANDIDATES). Email e pagina REALI del 26/11/2026 (fixture ripulite),
// codice di produzione per smistamento, recupero e salvataggio protetto, database
// simulato con i vincoli di unicità. Nessuna rete.
// Uso: deno test --allow-read=. supabase/functions/nmre-gmail-scheduled/subito_item_candidates_test.ts
import { classifyMailbox, emailFromGmailMessage } from "./_shared/mailbox.ts";
import { subitoItemCandidatesEnabled, subitoRowsForEmails, supabaseSubitoDeps } from "./_shared/subito_acquisition.ts";
import { newSaveCounters, saveCandidateRow } from "./_shared/save_candidate.ts";
import { assertAllRowsSaved, IncompleteSyncError, processRowsIsolated } from "./_shared/row_isolation.ts";
import { sellerClassificationDetails } from "./_shared/parser.ts";
import { parseSubitoResultsPage } from "./_shared/subito.ts";
import { fakeSupabase } from "./fake_supabase.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
  }
}
const fixture = (name: string) => Deno.readTextFileSync(new URL("./fixtures/" + name, import.meta.url));
const REAL_HTML = fixture("subito_real_email.html");
const REAL_TEXT = fixture("subito_real_email.txt");
const REAL_PAGE = fixture("subito_real_results_page.html");
const OWNER = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-11-26T10:00:00.000Z";
const FINAL_URL = "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/da-privati/?kxconfid=kxtest001&order=datedesc";
const SEARCH_KEY = "subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2";
const WINDOW_IDS = ["669796300", "669759841", "669743222", "669735500", "669729038", "669692985"];

const b64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const REAL_EMAIL = emailFromGmailMessage({
  id: "real-26", labelIds: ["INBOX"], snippet: "Ci sono nuovi risultati per la tua ricerca!",
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: "Subito <noreply@subito.it>" },
      { name: "Subject", value: "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te" },
      { name: "Date", value: "Thu, 26 Nov 2026 08:24:27 +0000" }
    ],
    parts: [
      { mimeType: "text/plain", body: { data: b64url(REAL_TEXT) } },
      { mimeType: "text/html", body: { data: b64url(REAL_HTML) } }
    ]
  }
});
const pageItems = () => parseSubitoResultsPage(REAL_PAGE).items;
const previousDigest = () => ({ owner_id: OWNER, stato: "da_verificare", titolo: "Ricerca salvata Subito · 25/11", dedup_key: "gmail:real-25",
  source_email_id: "real-25", data_pubblicazione: "2026-11-25T08:24:00.000Z", dati_fonte: { ricerca_subito: SEARCH_KEY }, dati_estratti: {} });

async function syncCycle(db: ReturnType<typeof fakeSupabase>, itemCandidates: boolean) {
  const emails = [REAL_EMAIL];
  const { subitoDigestById } = classifyMailbox(emails);
  const counters = newSaveCounters();
  const cycle = await subitoRowsForEmails(
    emails.map(e => ({ email: e, digest: subitoDigestById.get(String(e.id))! })),
    supabaseSubitoDeps(db.client, OWNER, () => Promise.resolve({ status: 200, finalUrl: FINAL_URL, html: REAL_PAGE })),
    { owner: OWNER, classifySeller: text => sellerClassificationDetails(text), now: () => NOW, itemCandidates }
  );
  const failures = [...cycle.failures, ...await processRowsIsolated(cycle.rows, row => String(row.notification_source_id || row.source_email_id),
    async row => { await saveCandidateRow(db.client, OWNER, row, counters, () => NOW); })];
  let advanced = false;
  try { assertAllRowsSaved(failures); advanced = true; } catch (error) { if (!(error instanceof IncompleteSyncError)) throw error; }
  return { failures, advanced };
}
const itemRows = (db: Any) => db.tables.annunci_candidati.filter((row: Any) => String(row.dedup_key || "").startsWith("subito:"));
const digestRow = (db: Any) => db.tables.annunci_candidati.find((row: Any) => row.dedup_key === "gmail:real-26");

Deno.test("interruttore: attivo solo con il valore esatto «true»", () => {
  for (const value of [undefined, "", "false", "1", "yes", "TRUE "]) eq(subitoItemCandidatesEnabled(value), value === "TRUE ", "valore " + JSON.stringify(value));
  eq(subitoItemCandidatesEnabled("true"), true, "true");
});

Deno.test("interruttore spento: comportamento invariato (solo la scheda riepilogativa)", async () => {
  const db = fakeSupabase({ annunci_candidati: [previousDigest()] });
  const { advanced } = await syncCycle(db, false);
  eq(advanced, true, "cursore avanzato");
  eq(itemRows(db).length, 0, "nessuna scheda singola");
  eq(digestRow(db)?.dati_estratti?.ricerca_subito?.stato, "da_verificare", "scheda riepilogativa da verificare");
  eq(digestRow(db)?.dati_estratti?.ricerca_subito?.schede_proposte, [], "nessuna scheda proposta registrata");
});

Deno.test("interruttore attivo, email precedente nota: i 6 annunci della finestra diventano 6 schede «Da verificare»", async () => {
  const db = fakeSupabase({ annunci_candidati: [previousDigest()] });
  const { advanced } = await syncCycle(db, true);
  eq(advanced, true, "cursore avanzato");
  const items = itemRows(db);
  eq(items.map((row: Any) => row.dedup_key.slice(7)).sort(), [...WINDOW_IDS].sort(), "una scheda per ogni annuncio della finestra");
  for (const row of items) {
    eq(row.stato, "da_verificare", "stato " + row.dedup_key);
    eq(row.dati_estratti.subito.novita_non_dimostrata, true, "contrassegno novità non dimostrata " + row.dedup_key);
    eq(row.dati_estratti.subito.motivo_novita, "conteggio_diverso", "motivo " + row.dedup_key);
    eq(/^https:\/\/www\.subito\.it\/.+-\d{6,}\.htm$/.test(row.url), true, "URL diretto " + row.dedup_key);
    eq(row.tipo_venditore !== "Agenzia" || row.stato === "da_verificare", true, "nessuno scartato");
  }
  eq(digestRow(db).dati_estratti.ricerca_subito.schede_proposte.length, 6, "scheda riepilogativa con l'elenco delle schede");
});

Deno.test("interruttore attivo, prima email della ricerca: ogni annuncio plausibile diventa una scheda, nessuno perso o scartato", async () => {
  const db = fakeSupabase();
  await syncCycle(db, true);
  const items = itemRows(db);
  const emailLimit = Date.parse("2026-11-26T08:29:27Z");
  const expected = pageItems().filter(item => !item.publishedAt || Date.parse(item.publishedAt) <= emailLimit).map(item => item.id);
  eq(expected.length > 0, true, "pagina reale letta");
  eq(items.map((row: Any) => row.dedup_key.slice(7)).sort(), [...expected].sort(), "tutti gli annunci plausibili (oltre il limite di 15 della scheda riepilogativa)");
  eq(items.length > 15, true, "più di 15 schede");
  eq(items.every((row: Any) => row.stato === "da_verificare"), true, "tutte «Da verificare»");
  const professional = items.filter((row: Any) => row.dati_estratti.subito.inserzionista_professionale === true);
  eq(professional.length > 0, true, "annunci professionali presenti");
  eq(professional.every((row: Any) => row.tipo_venditore === "Da verificare"), true, "professionisti indicati da Subito: «Da verificare», non Agenzia né scartati");
  eq(items.filter((row: Any) => row.dati_estratti.subito.inserzionista_professionale === false).every((row: Any) => row.tipo_venditore !== "Agenzia"), true,
    "privati indicati da Subito mai classificati agenzia senza prova nel testo");
});

Deno.test("interruttore attivo: duplicati e Archivio rispettati, dati manuali intatti, nessun doppione alla rielaborazione", async () => {
  const [manualId, archivedId] = WINDOW_IDS;
  const manual = { owner_id: OWNER, dedup_key: "subito:" + manualId, listing_key: "subito.it/appartamenti/titolo-manuale-" + manualId + ".htm",
    stato: "scartato", tipo_venditore: "Agenzia", seller_manual_override: true, titolo: "Titolo scelto a mano", prezzo: 99000, dati_estratti: {} };
  const db = fakeSupabase({
    annunci_candidati: [previousDigest(), manual],
    annunci: [{ owner_id: OWNER, url: "https://www.subito.it/appartamenti/archiviato-" + archivedId + ".htm", deleted_at: null }]
  });
  await syncCycle(db, true);
  const sameManual = db.tables.annunci_candidati.filter((row: Any) => row.dedup_key === "subito:" + manualId);
  eq(sameManual.length, 1, "nessun doppione dell'annuncio già presente");
  eq([sameManual[0].titolo, sameManual[0].prezzo, sameManual[0].stato, sameManual[0].tipo_venditore], ["Titolo scelto a mano", 99000, "scartato", "Agenzia"],
    "titolo, prezzo, stato e classificazione manuali invariati");
  eq(itemRows(db).some((row: Any) => row.dedup_key === "subito:" + archivedId), false, "annuncio già nell'Archivio non reinserito");
  eq(digestRow(db).dati_estratti.ricerca_subito.gia_in_archivio.map((entry: Any) => entry.id), [archivedId], "registrato nella scheda riepilogativa");
  const before = db.tables.annunci_candidati.length;
  await syncCycle(db, true);
  eq(db.tables.annunci_candidati.length, before, "seconda elaborazione della stessa email: nessuna riga in più");
});

Deno.test("interruttore attivo: confronto con l'Archivio non riuscito → nessuna scheda, cursore fermo", async () => {
  const db = fakeSupabase({ annunci_candidati: [previousDigest()] });
  db.state.fail = (table, op) => table === "annunci" && op === "select" ? { message: "timeout" } : null;
  const { advanced, failures } = await syncCycle(db, true);
  eq(advanced, false, "cursore non avanzato");
  eq(failures.length > 0, true, "errore registrato");
  eq(itemRows(db).length, 0, "nessuna scheda senza confronto");
});

// ---------- Scheda nell'app ----------
const html = Deno.readTextFileSync(new URL("../../../index.html", import.meta.url));
function grab(name: string): string {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  let depth = 0;
  for (let index = html.indexOf("){", start) + 1; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}
// deno-lint-ignore no-explicit-any
const ui = new Function(["validUrl", "nmreSubitoRecoveryHtml"].map(grab).join("\n") + ";return {nmreSubitoRecoveryHtml};")() as any;

Deno.test("app: la scheda singola dichiara novità non dimostrata e tipo di inserzionista; il riepilogo elenca le schede", async () => {
  const db = fakeSupabase({ annunci_candidati: [previousDigest()] });
  await syncCycle(db, true);
  const items = itemRows(db);
  const professional = items.find((row: Any) => row.dati_estratti.subito.inserzionista_professionale === true)!;
  const privateItem = items.find((row: Any) => row.dati_estratti.subito.inserzionista_professionale === false)!;
  eq(ui.nmreSubitoRecoveryHtml(professional).includes("data-subito-unproven"), true, "avviso di novità non dimostrata");
  eq(ui.nmreSubitoRecoveryHtml(professional).includes('data-subito-seller="professionista"'), true, "professionista indicato");
  eq(ui.nmreSubitoRecoveryHtml(privateItem).includes('data-subito-seller="privato"'), true, "privato indicato");
  const digest = ui.nmreSubitoRecoveryHtml(digestRow(db));
  eq(digest.includes("scheda singola «Da verificare»"), true, "il riepilogo spiega che ogni annuncio è in coda");
  eq((digest.match(/data-subito-listing=/g) || []).length, 6, "un link per ogni scheda");
});

Deno.test("novità non dimostrata: un testo da privato non porta all'archiviazione automatica", async () => {
  const db = fakeSupabase({ annunci_candidati: [previousDigest()] });
  const emails = [REAL_EMAIL];
  const { subitoDigestById } = classifyMailbox(emails);
  const cycle = await subitoRowsForEmails(
    emails.map(e => ({ email: e, digest: subitoDigestById.get(String(e.id))! })),
    supabaseSubitoDeps(db.client, OWNER, () => Promise.resolve({ status: 200, finalUrl: FINAL_URL, html: REAL_PAGE })),
    { owner: OWNER, classifySeller: () => ({ classification: "Privato", confidence: 99, evidence: "Etichetta esplicita: venditore privato" }), now: () => NOW, itemCandidates: true }
  );
  const items = cycle.rows.filter((row: Any) => String(row.dedup_key).startsWith("subito:"));
  eq(items.length, 6, "schede proposte");
  eq(items.every((row: Any) => row.tipo_venditore === "Da verificare" && row.seller_confidence === 0), true, "nessuna scheda «Privato»");
  const nonProfessional = items.filter((row: Any) => row.dati_estratti.subito.inserzionista_professionale !== true);
  eq(nonProfessional.length > 0, true, "annunci non professionali presenti");
  eq(nonProfessional.every((row: Any) => /Il testo indica un privato/.test(row.seller_evidence)), true, "indicazione conservata nell'evidenza");
  eq(items.filter((row: Any) => row.dati_estratti.subito.inserzionista_professionale === true)
    .every((row: Any) => /inserzionista professionale/.test(row.seller_evidence)), true, "professionisti: evidenza di Subito");
  const counters = newSaveCounters();
  for (const row of cycle.rows) await saveCandidateRow(db.client, OWNER, row, counters, () => NOW);
  eq(db.state.rpcCalls.filter(call => call.name === "nmre_auto_archive_private_candidate").length, 0, "nessuna archiviazione automatica richiesta");
});
