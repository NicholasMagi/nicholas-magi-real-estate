// Deduplicazione degli annunci Subito anche per URL (colonna url), su tutte le opportunità di
// qualunque stato e sull'Archivio (cestino compreso), con e senza titolo nell'URL; nessun falso
// positivo tra ID diversi; nessuna modifica dei record trovati. Codice di produzione, database
// simulato. Uso: deno test --allow-read=. supabase/functions/nmre-gmail-scheduled/subito_url_dedup_test.ts
import { classifyMailbox, emailFromGmailMessage } from "./_shared/mailbox.ts";
import { subitoItemRow, subitoRowsForEmails, supabaseSubitoDeps } from "./_shared/subito_acquisition.ts";
import { newSaveCounters, saveCandidateRow } from "./_shared/save_candidate.ts";
import { assertAllRowsSaved, processRowsIsolated } from "./_shared/row_isolation.ts";
import { sellerClassificationDetails } from "./_shared/parser.ts";
import { parseSubitoResultsPage } from "./_shared/subito.ts";
import type { SubitoItem } from "./_shared/subito.ts";
import { fakeSupabase } from "./fake_supabase.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
}
const OWNER = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-11-26T10:00:00.000Z";
const noFetch = () => Promise.reject(new Error("nessuna rete nei test"));
const deps = (db: ReturnType<typeof fakeSupabase>) => supabaseSubitoDeps(db.client, OWNER, noFetch);
const candidate = (extra: Record<string, unknown>) => ({ owner_id: OWNER, stato: "scartato", titolo: "Scheda esistente", note: "Nota manuale",
  seller_manual_override: true, tipo_venditore: "Privato", dedup_key: "gmail:legacy", source_email_id: "legacy", listing_key: null, dati_estratti: {}, ...extra });

// ---------- knownCandidate ----------

Deno.test("knownCandidate: opportunità scartata con URL Subito contenente l'ID, senza listing_key", async () => {
  const db = fakeSupabase({ annunci_candidati: [candidate({ url: "https://www.subito.it/appartamenti/bilocale-ancona-710000001.htm?utm_source=app" })] });
  eq(await deps(db).knownCandidate("710000001"), true, "riconosciuta per URL");
  eq(db.state.writes, 0, "sola lettura");
});

Deno.test("knownCandidate: URL senza titolo /<categoria>/<ID>.htm", async () => {
  const db = fakeSupabase({ annunci_candidati: [candidate({ url: "https://www.subito.it/appartamenti/710000002.htm" })] });
  eq(await deps(db).knownCandidate("710000002"), true, "riconosciuta per URL senza titolo");
});

Deno.test("knownCandidate: listing_key e dedup_key assenti o diversi, URL con l'ID", async () => {
  for (const extra of [
    { dedup_key: "gmail:altro", listing_key: null },
    { dedup_key: "gmail:altro", listing_key: "immobiliare.it/annunci/999999" },
    { dedup_key: "subito:799999999", listing_key: "subito.it/appartamenti/altro-799999999.htm" }
  ]) {
    const db = fakeSupabase({ annunci_candidati: [candidate({ ...extra, url: "https://www.subito.it/appartamenti/trilocale-osimo-710000003.htm" })] });
    eq(await deps(db).knownCandidate("710000003"), true, "riconosciuta con " + JSON.stringify(extra));
  }
});

Deno.test("knownCandidate: qualunque stato (da verificare, scartata, confermata, archiviata)", async () => {
  for (const stato of ["da_verificare", "scartato", "confermato", "archiviato"]) {
    const db = fakeSupabase({ annunci_candidati: [candidate({ stato, url: "https://www.subito.it/appartamenti/710000004.htm" })] });
    eq(await deps(db).knownCandidate("710000004"), true, "stato " + stato);
  }
});

Deno.test("nessun falso positivo tra ID diversi (prefissi, suffissi, altri siti, ID non validi)", async () => {
  const db = fakeSupabase({ annunci_candidati: [
    candidate({ url: "https://www.subito.it/appartamenti/casa-9710000005.htm" }),     // ID più lungo che termina con l'ID cercato
    candidate({ url: "https://www.subito.it/appartamenti/9710000005.htm" }),          // idem, senza titolo
    candidate({ url: "https://www.subito.it/appartamenti/casa-7100000051.htm" }),     // ID più lungo che inizia con l'ID cercato
    candidate({ url: "https://www.subito.it/appartamenti/casa-71000000.htm" }),       // ID più corto
    candidate({ url: "https://www.immobiliare.it/annunci/710000005/" })               // altro portale con lo stesso numero
  ] });
  eq(await deps(db).knownCandidate("710000005"), false, "nessuna corrispondenza");
  eq(await deps(db).knownCandidate("12345"), false, "ID non valido");
});

// ---------- Archivio (cestino compreso) ----------

Deno.test("Archivio: annuncio presente anche nel cestino, con e senza titolo nell'URL; nessun falso positivo", async () => {
  const db = fakeSupabase({ annunci: [
    { id: "a1", owner_id: OWNER, url: "https://www.subito.it/appartamenti/villa-ancona-710000006.htm", listing_key: null, deleted_at: null },
    { id: "a2", owner_id: OWNER, url: "https://www.subito.it/appartamenti/710000007.htm", listing_key: null, deleted_at: "2026-11-01T00:00:00Z" },
    { id: "a3", owner_id: OWNER, url: null, listing_key: "subito.it/appartamenti/710000008.htm", deleted_at: "2026-11-02T00:00:00Z" }
  ] });
  const d = deps(db);
  eq(await d.archivedListing("710000006"), { annuncioId: "a1", eliminato: false }, "in Archivio");
  eq(await d.archivedListing("710000007"), { annuncioId: "a2", eliminato: true }, "nel cestino, URL senza titolo");
  eq(await d.archivedListing("710000008"), { annuncioId: "a3", eliminato: true }, "nel cestino, chiave senza titolo");
  eq(await d.archivedListing("10000006"), null, "suffisso di un altro ID: nessuna corrispondenza");
  eq(db.state.writes, 0, "sola lettura");
});

// ---------- saveCandidateRow ----------

function item(id: string): SubitoItem {
  return { id, url: "https://www.subito.it/appartamenti/nuovo-titolo-" + id + ".htm", title: "Nuovo titolo " + id, description: null, price: 150000,
    location: "Ancona", surfaceMq: 80, rooms: 3, images: [], publishedAt: null, advertiserCompany: false };
}
const DIGEST = { declaredCount: 3, searchLabel: "Appartamenti a Ancona", searchUrl: "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2",
  searchKey: "subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2", linkSource: "pulsante" as const, unresolvedLink: null, emailListingUrls: [] };
const rowFor = (id: string) => subitoItemRow(item(id), { owner: OWNER, email: { id: "e-1", from: "Subito <noreply@subito.it>", subject: "x", date: "Thu, 26 Nov 2026 08:24:27 +0000" },
  digest: DIGEST, classifySeller: sellerClassificationDetails, nowIso: NOW }, { pageSource: "next_data" });

Deno.test("saveCandidateRow: scheda esistente trovata solo per URL (scartata, chiavi diverse) → nessuna nuova scheda, scheda identica", async () => {
  for (const url of ["https://www.subito.it/appartamenti/vecchio-titolo-710000009.htm", "https://www.subito.it/appartamenti/710000009.htm"]) {
    const db = fakeSupabase({ annunci_candidati: [candidate({ url, dedup_key: "gmail:legacy", listing_key: "immobiliare.it/annunci/1" })] });
    const before = JSON.stringify(db.tables.annunci_candidati[0]);
    const counters = newSaveCounters();
    const id = await saveCandidateRow(db.client, OWNER, rowFor("710000009") as Any, counters, () => NOW);
    eq([db.tables.annunci_candidati.length, id, counters.inserted, counters.updated], [1, "seed-1", 0, 0], "nessun inserimento e nessun aggiornamento (" + url + ")");
    eq(JSON.stringify(db.tables.annunci_candidati[0]), before, "scheda trovata identica campo per campo (" + url + ")");
    eq(db.state.rpcCalls.length, 0, "nessuna archiviazione automatica");
    const history = db.tables.annunci_candidati_notifiche;
    eq([history.length, history[0]?.candidate_id], [1, "seed-1"], "la notifica resta nello storico, collegata alla scheda esistente");
  }
});

Deno.test("saveCandidateRow: ID diverso nell'URL → nuova scheda, scheda esistente intatta", async () => {
  const db = fakeSupabase({ annunci_candidati: [candidate({ url: "https://www.subito.it/appartamenti/casa-9710000010.htm" })] });
  const before = JSON.stringify(db.tables.annunci_candidati[0]);
  const counters = newSaveCounters();
  await saveCandidateRow(db.client, OWNER, rowFor("710000010") as Any, counters, () => NOW);
  eq([db.tables.annunci_candidati.length, counters.inserted], [2, 1], "nuova scheda per l'ID diverso");
  eq(JSON.stringify(db.tables.annunci_candidati[0]), before, "scheda esistente intatta");
});

Deno.test("percorso completo (email + pagina reale): annuncio nel cestino dell'Archivio con opportunità scartata solo per URL → nessun doppione, nulla modificato", async () => {
  const fixture = (name: string) => Deno.readTextFileSync(new URL("./fixtures/" + name, import.meta.url));
  const page = fixture("subito_real_results_page.html");
  const target = parseSubitoResultsPage(page).items[0];
  const b64 = (text: string) => { let s = ""; for (const byte of new TextEncoder().encode(text)) s += String.fromCharCode(byte); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const email = emailFromGmailMessage({ id: "real-26", labelIds: ["INBOX"], snippet: "", payload: { mimeType: "multipart/alternative",
    headers: [{ name: "From", value: "Subito <noreply@subito.it>" }, { name: "Subject", value: "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te" }, { name: "Date", value: "Thu, 26 Nov 2026 08:24:27 +0000" }],
    parts: [{ mimeType: "text/plain", body: { data: b64(fixture("subito_real_email.txt")) } }, { mimeType: "text/html", body: { data: b64(fixture("subito_real_email.html")) } }] } });
  const slugless = "https://www.subito.it/appartamenti/" + target.id + ".htm";
  const db = fakeSupabase({
    annunci_candidati: [candidate({ url: slugless })],
    annunci: [{ id: "a9", owner_id: OWNER, url: slugless, listing_key: null, deleted_at: "2026-11-05T00:00:00Z" }]
  });
  const before = JSON.stringify({ c: db.tables.annunci_candidati[0], a: db.tables.annunci });
  const { subitoDigestById } = classifyMailbox([email]);
  const cycle = await subitoRowsForEmails([{ email, digest: subitoDigestById.get("real-26")! }],
    supabaseSubitoDeps(db.client, OWNER, () => Promise.resolve({ status: 200, finalUrl: "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/da-privati/?kxconfid=kxtest001&order=datedesc", html: page })),
    { owner: OWNER, classifySeller: sellerClassificationDetails, now: () => NOW, itemCandidates: true });
  const counters = newSaveCounters();
  const failures = [...cycle.failures, ...await processRowsIsolated(cycle.rows, row => String(row.notification_source_id || row.source_email_id),
    async row => { await saveCandidateRow(db.client, OWNER, row, counters, () => NOW); })];
  assertAllRowsSaved(failures);
  eq(db.tables.annunci_candidati.filter((row: Any) => row.dedup_key === "subito:" + target.id).length, 0, "nessuna seconda scheda per l'annuncio");
  eq(JSON.stringify({ c: db.tables.annunci_candidati[0], a: db.tables.annunci }), before, "scheda scartata e Archivio identici");
});

Deno.test("altre righe (non Subito acquisite): confronto per URL non applicato, comportamento invariato", () => {
  const code = Deno.readTextFileSync(new URL("./_shared/save_candidate.ts", import.meta.url));
  eq(/if \(!canonicalCandidate && row\.history_only && subitoId && /.test(code), true, "ricerca per URL solo per gli annunci Subito acquisiti (history_only)");
  eq(/\.eq\("stato"|\.neq\("stato"|\.in\("stato"/.test(code), false, "nessun filtro sullo stato nella ricerca del candidato esistente");
});
