// Acquisizione dell'INTERA ricerca salvata Subito (NMRE_SUBITO_FULL_SEARCH). Email REALE del
// 26/11/2026 e struttura REALE della pagina dei risultati (fixture ripulite); le pagine
// successive sono costruite dalla pagina reale cambiando solo l'elenco degli annunci e il
// numero di pagina. Codice di produzione per smistamento, recupero, deduplicazione,
// salvataggio protetto e registro; database simulato con i vincoli di unicità. Nessuna rete.
// Uso: deno test --allow-read=. supabase/functions/nmre-gmail-scheduled/subito_full_search_test.ts
import { classifyMailbox, emailFromGmailMessage } from "./_shared/mailbox.ts";
import { supabaseSubitoDeps } from "./_shared/subito_acquisition.ts";
import {
  fetchWholeSubitoSearch, fullSearchSeller, professionalHint, subitoSellerFilter, planSubitoDuplicateMerge, saveFullSearchLogs, subitoFullSearchEnabled, subitoFullSearchRows,
  supabaseFullSearchDeps
} from "./_shared/subito_full_search.ts";
import { missingFieldsPatch, newSaveCounters, saveCandidateRow } from "./_shared/save_candidate.ts";
import { assertAllRowsSaved, IncompleteSyncError, processRowsIsolated } from "./_shared/row_isolation.ts";
import { sellerClassificationDetails } from "./_shared/parser.ts";
import { parseSubitoResultsPage, subitoSearchPageUrl } from "./_shared/subito.ts";
import { fakeSupabase } from "./fake_supabase.ts";
import type { FailRule } from "./fake_supabase.ts";

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
const SEARCH_KEY = "subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2";

const b64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
function realEmail(id: string, date = "Thu, 26 Nov 2026 08:24:27 +0000") {
  return emailFromGmailMessage({
    id, labelIds: ["INBOX"], snippet: "Ci sono nuovi risultati per la tua ricerca!",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "Subito <noreply@subito.it>" },
        { name: "Subject", value: "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te" },
        { name: "Date", value: date }
      ],
      parts: [{ mimeType: "text/plain", body: { data: b64url(REAL_TEXT) } }, { mimeType: "text/html", body: { data: b64url(REAL_HTML) } }]
    }
  });
}

// ---------- Pagine costruite dalla struttura reale ----------
const NEXT_RE = /(<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>)([\s\S]*?)(<\/script>)/i;
const REAL_DATA = JSON.parse(REAL_PAGE.match(NEXT_RE)![2]);
const TEMPLATE = REAL_DATA.props.pageProps.initialState.items.originalList[0];
type Ad = { id: string; company?: boolean | null; town?: string; price?: number; size?: number; subject?: string };
function adEntry(ad: Ad): Any {
  const entry = structuredClone(TEMPLATE);
  const target = entry.item && !entry.urls ? entry.item : entry;
  target.urls = { ...(target.urls || {}), default: "https://www.subito.it/appartamenti/appartamento-prova-ancona-" + ad.id + ".htm" };
  target.subject = ad.subject ?? "Appartamento di prova " + ad.id;
  target.body = "Appartamento luminoso, terzo piano.";
  target.date = "2026-11-25 10:00:00";
  if (ad.company === undefined) delete target.advertiser;
  else target.advertiser = { name: "Inserzionista", type: ad.company ? 1 : 0, company: ad.company };
  target.geo = { ...(target.geo || {}), town: { value: ad.town ?? "Ancona" } };
  target.features = [
    { uri: "/price", values: [{ key: String(ad.price ?? 150000), value: (ad.price ?? 150000) + " €" }] },
    { uri: "/size", values: [{ key: String(ad.size ?? 80), value: (ad.size ?? 80) + " mq" }] }
  ];
  return entry;
}
function pageHtml(ads: Ad[], options: { page: number; totalPages: number | null; total?: number }): string {
  const data = structuredClone(REAL_DATA);
  const items = data.props.pageProps.initialState.items;
  items.originalList = ads.map(adEntry);
  items.total = options.total ?? ads.length * (options.totalPages || 1);
  if (options.totalPages === null) delete items.totalPages; else items.totalPages = options.totalPages;
  data.props.pageProps.initialState.search.page = options.page;
  return REAL_PAGE.replace(NEXT_RE, (_m, open, _json, close) => open + JSON.stringify(data) + close);
}
const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => String(700000000 + from + i));
/** Ricerca di più pagine: page → annunci; la richiesta con o=N riceve la pagina N. */
function site(pages: Ad[][], overrides: Record<number, { status?: number; html?: string; throws?: boolean }> = {}) {
  const requests: string[] = [];
  const fetchPage = (url: string) => {
    requests.push(url);
    const number = Number(new URL(url).searchParams.get("o") || "1");
    const override = overrides[number];
    if (override?.throws) return Promise.reject(new Error("rete"));
    const html = override?.html ?? (pages[number - 1] ? pageHtml(pages[number - 1], { page: number, totalPages: pages.length }) : "<html></html>");
    return Promise.resolve({ status: override?.status ?? 200, finalUrl: url, html });
  };
  return { fetchPage, requests };
}

const emailEntries = (emails: Any[]) => {
  const { subitoDigestById } = classifyMailbox(emails);
  return emails.map(email => ({ email, digest: subitoDigestById.get(String(email.id))! }));
};
/** Un ciclo come in index.ts: righe, salvataggio isolato, cursore, registro. */
async function cycle(db: ReturnType<typeof fakeSupabase>, emails: Any[], fetchPage: Any, extra: { maxPagesPerRun?: number } = {}) {
  const counters = newSaveCounters();
  const deps = supabaseFullSearchDeps(db.client, OWNER, supabaseSubitoDeps(db.client, OWNER, fetchPage));
  const result = await subitoFullSearchRows(emailEntries(emails), deps,
    { owner: OWNER, classifySeller: text => sellerClassificationDetails(text), now: () => NOW, ...extra });
  const failures = [...result.failures, ...await processRowsIsolated(result.rows, row => String(row.notification_source_id || row.source_email_id),
    async row => { await saveCandidateRow(db.client, OWNER, row, counters, () => NOW); })];
  let advanced = false;
  try {
    assertAllRowsSaved(failures);
    await saveFullSearchLogs(db.client, result.logs);
    advanced = true;
  } catch (error) { if (!(error instanceof IncompleteSyncError) && !/Registro/.test(String(error))) throw error; }
  return { result, failures, advanced, counters };
}
const cards = (db: Any) => db.tables.annunci_candidati.filter((row: Any) => String(row.dedup_key || "").startsWith("subito:"));
const digest = (db: Any, id = "e-1") => db.tables.annunci_candidati.find((row: Any) => row.dedup_key === "gmail:" + id);
const logs = (db: Any) => db.tables.nmre_subito_ricerche_sync || [];

Deno.test("interruttore: attivo solo con il valore esatto «true»", () => {
  for (const value of [undefined, "", "false", "1", "yes", "TRUE"]) eq(subitoFullSearchEnabled(value), value === "TRUE", "valore " + JSON.stringify(value));
  eq(subitoFullSearchEnabled("true"), true, "true");
});

Deno.test("1 · email di una ricerca conosciuta: ricerca riconosciuta, filtri (privati) mantenuti in ogni richiesta", async () => {
  const db = fakeSupabase();
  const web = site([ids(0, 30).map(id => ({ id, company: false })), ids(30, 5).map(id => ({ id, company: false }))]);
  const { advanced } = await cycle(db, [realEmail("e-1")], web.fetchPage);
  eq(advanced, true, "cursore avanzato");
  eq(web.requests.length, 2, "due pagine richieste");
  for (const url of web.requests) {
    eq(new URL(url).searchParams.get("advt"), "0,2", "filtro sugli inserzionisti mantenuto: " + url);
    eq(new URL(url).pathname, "/annunci-marche/vendita/appartamenti/ancona/", "stessa ricerca: " + url);
  }
  eq(logs(db).length, 1, "una riga di registro");
  eq(logs(db)[0].ricerca_chiave, SEARCH_KEY, "ricerca riconosciuta");
  eq(logs(db)[0].ricerca_nome, "Appartamenti a Ancona e provincia", "nome della ricerca");
  eq(logs(db)[0].dettagli.filtro_venditore, "privati", "filtro privati riconosciuto nel link e registrato");
});

Deno.test("1-bis · filtro privati controllato su ogni pagina: una pagina con filtri diversi viene rifiutata, nessuna classificazione dal solo filtro", async () => {
  const db = fakeSupabase();
  const lost = pageHtml(ids(30, 30).map(id => ({ id })), { page: 2, totalPages: 2 }).replace(/"advt":"0,2"/g, '"advt":"0,1"');
  const web = site([ids(0, 30), ids(30, 30)].map(list => list.map(id => ({ id }))), { 2: { html: lost } });
  await cycle(db, [realEmail("e-1")], web.fetchPage);
  eq([logs(db)[0].esito, logs(db)[0].motivo], ["parziale", "pagina_successiva_non_valida"], "pagina con il filtro cambiato: lettura fermata");
  eq(cards(db).length, 30, "nessun annuncio della ricerca diversa");
  eq(cards(db).every((row: Any) => row.tipo_venditore === "Da verificare"), true, "filtro privati presente ma tipo non indicato dalle schede: tutte Da verificare");
  for (const [url, status] of [
    ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/da-privati/", "privati"],
    ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2", "privati"],
    ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C1", "non_privati"],
    ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/", "non_rilevato"]
  ] as const) eq(subitoSellerFilter(url).status, status, "filtro di " + url);
});

Deno.test("2 · più annunci di quelli citati nell'email: entrano tutti, senza selezione manuale, con la normale notifica", async () => {
  const db = fakeSupabase();
  const web = site([ids(0, 10).map(id => ({ id, company: false }))]);
  await cycle(db, [realEmail("e-1")], web.fetchPage);
  eq(cards(db).length, 10, "10 schede (l'email ne dichiarava 3)");
  eq(cards(db).every((row: Any) => row.stato === "da_verificare"), true, "tutte in Nuove opportunità");
  eq(cards(db).every((row: Any) => !row.dati_estratti.subito.novita_non_dimostrata && !row.dati_estratti.subito.notifica_raggruppata), true,
    "nessun contrassegno: fino a 10 nuove schede ognuna ha la normale notifica di nuova opportunità");
  eq([logs(db)[0].nuove_opportunita, logs(db)[0].annunci_trovati, logs(db)[0].notifica_raggruppata], [10, 10, false], "registro");
  eq(digest(db), undefined, "nessuna scheda riepilogativa quando la ricerca è completa e le notifiche sono singole");
  eq(db.state.rpcCalls.filter(call => call.name === "nmre_auto_archive_private_candidate").length, 0, "nessuna archiviazione automatica");
});

Deno.test("2-bis · prima sincronizzazione di una ricerca ampia: tutte le schede create, una sola notifica riepilogativa", async () => {
  const db = fakeSupabase();
  const pages = Array.from({ length: 9 }, (_, page) => ids(page * 30, page === 8 ? 23 : 30).map(id => ({ id, company: false })));
  await cycle(db, [realEmail("e-1")], site(pages).fetchPage);
  eq(cards(db).length, 263, "263 schede: nessuna opportunità persa");
  eq(cards(db).every((row: Any) => row.dati_estratti.subito.notifica_raggruppata === true && row.stato === "da_verificare"), true,
    "tutte in Nuove opportunità, senza notifica singola (condizione del trigger)");
  const summary = digest(db);
  eq(summary.titolo, "Ricerca salvata Subito · Appartamenti a Ancona e provincia · 263 nuove opportunità", "titolo dell'unica notifica");
  eq([summary.stato, summary.tipo_venditore, summary.dati_estratti.subito], ["da_verificare", "Da verificare", undefined],
    "la scheda riepilogativa è una normale opportunità senza contrassegno: genera la sua notifica");
  eq([summary.dati_estratti.ricerca_subito.notifica_raggruppata, summary.dati_estratti.ricerca_subito.nuove_opportunita], [true, 263], "riepilogo");
  eq([logs(db)[0].notifica_raggruppata, logs(db)[0].nuove_opportunita], [true, 263], "registro");
  const notifying = db.tables.annunci_candidati.filter((row: Any) => row.stato === "da_verificare" && row.tipo_venditore !== "Agenzia"
    && row.dati_estratti?.subito?.notifica_raggruppata !== true && row.dati_estratti?.subito?.novita_non_dimostrata !== true);
  eq(notifying.length, 1, "con la condizione del trigger: una sola notifica invece di 263");
  // Sincronizzazione successiva con 3 nuovi annunci: notifiche singole normali, nessun nuovo riepilogo.
  await cycle(db, [realEmail("e-2", "Fri, 27 Nov 2026 08:24:27 +0000")], site([[...ids(900, 3), ...ids(0, 27)].map(id => ({ id, company: false }))]).fetchPage);
  const fresh = cards(db).filter((row: Any) => ids(900, 3).includes(row.dedup_key.slice(7)));
  eq(fresh.length, 3, "3 nuove schede");
  eq(fresh.every((row: Any) => !row.dati_estratti.subito.notifica_raggruppata), true, "notifiche singole per le nuove");
  eq(digest(db, "e-2"), undefined, "nessun riepilogo per poche novità");
  // Rielaborazione della prima email: nessuna nuova scheda e nessuna nuova notifica riepilogativa.
  const before = db.tables.annunci_candidati.length;
  await cycle(db, [realEmail("e-1")], site(pages).fetchPage);
  eq(db.tables.annunci_candidati.length, before, "nessun doppione, nessun nuovo riepilogo");
});

Deno.test("3 · ricerca con paginazione: tutte le pagine dichiarate, numero di pagina confermato", async () => {
  const db = fakeSupabase();
  const web = site([ids(0, 30), ids(30, 30), ids(60, 7)].map(list => list.map(id => ({ id, company: false }))));
  await cycle(db, [realEmail("e-1")], web.fetchPage);
  eq(web.requests.map(url => new URL(url).searchParams.get("o")), [null, "2", "3"], "pagine 1, 2 e 3");
  eq(cards(db).length, 67, "67 schede");
  eq([logs(db)[0].esito, logs(db)[0].pagine_lette, logs(db)[0].pagine_dichiarate], ["completa", 3, 3], "registro completo");
  // Pagina che non conferma il proprio numero (o=2 ignorato da Subito): nessuna supposizione.
  const db2 = fakeSupabase();
  const wrong = site([ids(0, 30), ids(30, 30)].map(list => list.map(id => ({ id, company: false }))),
    { 2: { html: pageHtml(ids(30, 30).map(id => ({ id, company: false })), { page: 1, totalPages: 2 }) } });
  await cycle(db2, [realEmail("e-1")], wrong.fetchPage);
  eq([logs(db2)[0].esito, logs(db2)[0].motivo], ["parziale", "paginazione_non_verificabile"], "lettura fermata");
  eq(cards(db2).length, 30, "importati solo gli annunci della pagina verificata");
  eq(digest(db2).dati_estratti.ricerca_subito.nuovo_tentativo, true, "ricerca in attesa di recupero");
  // Pagina successiva che ripete gli annunci già letti.
  const db3 = fakeSupabase();
  const repeated = site([ids(0, 30), ids(0, 30)].map(list => list.map(id => ({ id, company: false }))));
  await cycle(db3, [realEmail("e-1")], repeated.fetchPage);
  eq(logs(db3)[0].motivo, "paginazione_ripetuta", "paginazione ripetuta riconosciuta");
  eq(cards(db3).length, 30, "nessun doppione");
  // URL della pagina N: stessi parametri, o=N.
  eq(new URL(subitoSearchPageUrl("https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&o=5", 1)!).searchParams.get("o"), null, "pagina 1 senza o");
  eq(new URL(subitoSearchPageUrl("https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2", 4)!).searchParams.get("o"), "4", "pagina 4");
  eq(parseSubitoResultsPage(REAL_PAGE).totalPages, 9, "pagina reale: 9 pagine dichiarate");
  eq(parseSubitoResultsPage(REAL_PAGE).pageNumber, 1, "pagina reale: pagina 1");
});

Deno.test("3-bis · limite di pagine per ciclo: lettura parziale dichiarata, completata al ciclo successivo senza doppioni", async () => {
  const db = fakeSupabase();
  const web = site([ids(0, 30), ids(30, 30), ids(60, 30)].map(list => list.map(id => ({ id, company: false }))));
  const first = await cycle(db, [realEmail("e-1")], web.fetchPage, { maxPagesPerRun: 2 });
  eq(first.advanced, true, "ciclo salvato");
  eq([logs(db)[0].esito, logs(db)[0].motivo], ["parziale", "ricerca_parziale_limite"], "parziale per limite");
  eq(cards(db).length, 60, "60 schede dalle due pagine lette");
  eq(digest(db).data_extraction_version < first.result.rows.find((row: Any) => row.dedup_key === "gmail:e-1").data_extraction_version + 1, true, "riga da rielaborare");
  await cycle(db, [realEmail("e-1")], web.fetchPage);
  eq(cards(db).length, 90, "90 schede dopo il secondo ciclo, nessuna doppia");
  eq(logs(db).length, 1, "stessa riga di registro aggiornata");
  eq(logs(db)[0].esito, "completa", "ora completa");
  eq(digest(db).dati_estratti.ricerca_subito.nuovo_tentativo, false, "ricerca non più in attesa di recupero");
});

Deno.test("4 · annuncio già in Opportunità: nessuna seconda scheda, solo i campi vuoti completati, note e dati manuali intatti", async () => {
  const [known] = ids(0, 1);
  const db = fakeSupabase({
    annunci_candidati: [{
      owner_id: OWNER, stato: "contattato", titolo: "Titolo scritto a mano", comune: null, prezzo: 150000, superficie_mq: 95,
      tipo_venditore: "Privato", seller_manual_override: true, dedup_key: "subito:" + known,
      listing_key: "subito.it/appartamenti/appartamento-prova-ancona-" + known + ".htm", source_email_id: "old",
      note: "Nota manuale da conservare", dati_estratti: { subito: { id: known, descrizione: "Descrizione inserita prima" }, appunti: "x" }
    }],
    annunci_candidati_notifiche: [{ owner_id: OWNER, candidate_id: "seed-1", source_email_id: "old", listing_price: 150000, notified_at: "2026-11-20T10:00:00Z" }]
  });
  const web = site([[{ id: known, company: false, size: 80 }, ...ids(1, 2).map(id => ({ id, company: false }))]]);
  const { counters } = await cycle(db, [realEmail("e-1")], web.fetchPage);
  const rows = cards(db).filter((row: Any) => row.dedup_key === "subito:" + known);
  eq(rows.length, 1, "una sola scheda per l'annuncio");
  const row = rows[0];
  eq([row.titolo, row.stato, row.tipo_venditore, row.note, row.superficie_mq], ["Titolo scritto a mano", "contattato", "Privato", "Nota manuale da conservare", 95],
    "titolo, stato, classificazione, note e superficie (95, non 80) non sovrascritti");
  eq(row.comune, "Ancona", "comune vuoto completato");
  eq(row.dati_estratti.subito.descrizione, "Descrizione inserita prima", "dato Subito già presente non sostituito");
  eq(row.dati_estratti.appunti, "x", "altri dati conservati");
  eq(db.tables.annunci_candidati_notifiche.filter((n: Any) => n.candidate_id === row.id).length, 1, "prezzo invariato: nessuna nuova notifica nello storico");
  eq(counters.sightingsWithoutChanges, 1, "ritrovamento senza novità");
  eq(cards(db).length, 3, "le altre due diventano nuove schede");
  eq(logs(db)[0].gia_in_opportunita, 1, "registro: un annuncio già in Opportunità");
});

Deno.test("4-bis · annuncio ritrovato con un prezzo diverso: storico aggiornato, dati della scheda invariati", async () => {
  const [known] = ids(0, 1);
  const db = fakeSupabase({
    annunci_candidati: [{ owner_id: OWNER, stato: "da_verificare", titolo: "Annuncio", comune: "Ancona", prezzo: 160000, dedup_key: "subito:" + known,
      listing_key: "subito.it/appartamenti/appartamento-prova-ancona-" + known + ".htm", source_email_id: "old", dati_estratti: {} }],
    annunci_candidati_notifiche: [{ owner_id: OWNER, candidate_id: "seed-1", source_email_id: "old", listing_price: 160000, notified_at: "2026-11-20T10:00:00Z" }]
  });
  await cycle(db, [realEmail("e-1")], site([[{ id: known, company: false, price: 150000 }]]).fetchPage);
  const history = db.tables.annunci_candidati_notifiche.filter((n: Any) => n.candidate_id === "seed-1");
  eq(history.length, 2, "nuova voce nello storico");
  eq(history[1].previous_price, 160000, "ribasso registrato");
  eq(cards(db)[0].prezzo, 160000, "prezzo della scheda non sovrascritto (resta nello storico)");
});

Deno.test("5 · annuncio già in Archivio: non reimportato tra le opportunità", async () => {
  const [archivedId, other] = ids(0, 2);
  const db = fakeSupabase({ annunci: [
    { owner_id: OWNER, url: "https://www.subito.it/appartamenti/titolo-qualsiasi-" + archivedId + ".htm", listing_key: null, deleted_at: null }
  ] });
  await cycle(db, [realEmail("e-1")], site([[{ id: archivedId, company: false }, { id: other, company: false }]]).fetchPage);
  eq(cards(db).map((row: Any) => row.dedup_key), ["subito:" + other], "solo l'annuncio non archiviato");
  eq(logs(db)[0].gia_in_archivio, 1, "registro: un annuncio già archiviato");
  eq(db.tables.annunci.length, 1, "Archivio non modificato");
});

Deno.test("6 · duplicato con URL diverso ma stesso ID: riconosciuto", async () => {
  const [known] = ids(0, 1);
  const db = fakeSupabase({ annunci_candidati: [{ owner_id: OWNER, stato: "da_verificare", titolo: "Vecchio titolo", comune: "Ancona",
    dedup_key: "gmail:legacy", source_email_id: "legacy", listing_key: "subito.it/appartamenti/vecchio-titolo-diverso-" + known + ".htm", dati_estratti: {} }] });
  await cycle(db, [realEmail("e-1")], site([[{ id: known, company: false }]]).fetchPage);
  eq(db.tables.annunci_candidati.length, 1, "nessuna seconda scheda");
  eq(logs(db)[0].gia_in_opportunita, 1, "riconosciuto per ID");
  // Due schede con lo stesso ID (dati storici): segnalate, nessuna unione automatica.
  const db2 = fakeSupabase({ annunci_candidati: [
    { owner_id: OWNER, stato: "da_verificare", dedup_key: "subito:" + known, listing_key: null, source_email_id: "a", dati_estratti: { subito: { id: known } } },
    { owner_id: OWNER, stato: "scartato", dedup_key: "gmail:b", listing_key: "subito.it/appartamenti/altro-" + known + ".htm", source_email_id: "b", dati_estratti: {} }
  ] });
  await cycle(db2, [realEmail("e-1")], site([[{ id: known, company: false }]]).fetchPage);
  eq(db2.tables.annunci_candidati.length, 2, "nessuna scheda cancellata o unita");
  eq(logs(db2)[0].duplicati_da_unificare, 1, "duplicato da unificare segnalato nel registro");
});

Deno.test("7 · annunci simili ma immobili diversi: nuova scheda, segnalata come possibile duplicato, nessuna unione", async () => {
  const [existingId, similarId] = ids(0, 2);
  const db = fakeSupabase({ annunci_candidati: [{ owner_id: OWNER, stato: "da_verificare", titolo: "Appartamento di prova", portale: "subito.it",
    comune: "Ancona", prezzo: 150000, superficie_mq: 80, dedup_key: "subito:" + existingId,
    listing_key: "subito.it/appartamenti/appartamento-prova-ancona-" + existingId + ".htm", source_email_id: "x", dati_estratti: { subito: { id: existingId } } }] });
  await cycle(db, [realEmail("e-1")], site([[{ id: similarId, company: false, price: 150000, size: 80 }]]).fetchPage);
  eq(cards(db).length, 2, "due schede distinte");
  const created = cards(db).find((row: Any) => row.dedup_key === "subito:" + similarId);
  eq(created.dati_estratti.subito.possibili_duplicati, [{ candidato_id: "seed-1", subito_id: existingId }], "possibile duplicato segnalato");
  eq(cards(db).find((row: Any) => row.dedup_key === "subito:" + existingId).titolo, "Appartamento di prova", "scheda esistente intatta");
  eq(planSubitoDuplicateMerge({ id: "a", dati_estratti: { subito: { id: existingId } } }, { id: "b", dati_estratti: { subito: { id: similarId } } }),
    { ok: false, reason: "immobili_diversi" }, "unificazione rifiutata per immobili diversi");
});

Deno.test("8-9 · inserzionista professionale, privato e non verificabile", async () => {
  const [pro, priv, unknown, agencyText] = ids(0, 4);
  const db = fakeSupabase();
  await cycle(db, [realEmail("e-1")], site([[
    { id: pro, company: true }, { id: priv, company: false }, { id: unknown },
    { id: agencyText, company: false, subject: "Agenzia immobiliare propone appartamento, provvigione esclusa" }
  ]]).fetchPage);
  const by = (id: string) => cards(db).find((row: Any) => row.dedup_key === "subito:" + id);
  eq(by(pro).tipo_venditore, "Da verificare", "professionista: mai privato");
  eq(by(priv).tipo_venditore, "Privato", "privato indicato da Subito per l'annuncio");
  eq(by(priv).stato, "da_verificare", "privato resta in Nuove opportunità");
  eq(by(unknown).tipo_venditore, "Da verificare", "tipo non indicato: Da verificare (il filtro della ricerca non basta)");
  eq(by(agencyText).tipo_venditore, "Da verificare", "Subito dice privato ma il testo parla di agenzia: Da verificare, mai privato");
  for (const [text, hint] of [["Privato vende, no agenzie", false], ["Astenersi agenzie", false], ["Senza provvigione", false], ["Provvigione 3%", true],
    ["Agenzia Rossi propone", true], ["Contattare Tecnocasa", true], ["Appartamento luminoso", false]] as const) {
    eq(professionalHint(text), hint, "riferimento professionale in " + JSON.stringify(text));
  }
  eq([logs(db)[0].professionali, logs(db)[0].da_verificare >= 2], [1, true], "registro: professionali e da verificare");
  eq(db.state.rpcCalls.length, 0, "nessuna archiviazione automatica");
  const classify = () => ({ classification: "Privato" as const, confidence: 0.95, evidence: "testo" });
  eq(fullSearchSeller({ id: "1", url: "", title: null, description: null, price: null, location: null, surfaceMq: null, rooms: null, images: [], publishedAt: null, advertiserCompany: true }, classify).classification,
    "Da verificare", "professionista indicato da Subito anche se il testo sembra di un privato");
  eq(fullSearchSeller({ id: "1", url: "", title: null, description: null, price: null, location: null, surfaceMq: null, rooms: null, images: [], publishedAt: null, advertiserCompany: null }, classify).classification,
    "Da verificare", "testo da privato senza conferma di Subito: Da verificare");
});

Deno.test("10 · recupero bloccato da Subito: errore chiaro, ricerca in attesa di recupero, nessuna importazione simulata", async () => {
  for (const [label, overrides, reason] of [
    ["HTTP 403", { 1: { status: 403, html: "<html>Access denied</html>" } }, "pagina_bloccata"],
    ["CAPTCHA", { 1: { html: fixture("subito_results_page_captcha.html") } }, "pagina_bloccata"],
    ["rete", { 1: { throws: true } }, "errore_rete"],
    ["HTTP 500", { 1: { status: 500, html: "<html></html>" } }, "errore_http"]
  ] as const) {
    const db = fakeSupabase();
    const { advanced } = await cycle(db, [realEmail("e-1")], site([ids(0, 30).map(id => ({ id, company: false }))], overrides as Any).fetchPage);
    eq(advanced, true, label + ": ciclo salvato");
    eq(cards(db).length, 0, label + ": nessuna scheda");
    eq([logs(db)[0].esito, logs(db)[0].motivo, logs(db)[0].nuovo_tentativo], ["errore", reason, true], label + ": registro");
    const pending = digest(db);
    eq(pending?.dati_estratti?.ricerca_subito?.motivo, reason, label + ": ricerca visibile in Opportunità con il motivo");
    eq(pending?.dati_estratti?.ricerca_subito?.nuovo_tentativo, true, label + ": nuovo tentativo previsto");
  }
  // Pagina 2 bloccata: gli annunci reali della pagina 1 restano, la ricerca resta da completare.
  const db = fakeSupabase();
  await cycle(db, [realEmail("e-1")], site([ids(0, 30), ids(30, 30)].map(list => list.map(id => ({ id, company: false }))), { 2: { status: 403 } }).fetchPage);
  eq([logs(db)[0].esito, logs(db)[0].motivo], ["parziale", "ricerca_parziale_bloccata"], "pagina 2 bloccata: parziale");
  eq(cards(db).length, 30, "solo gli annunci effettivamente letti");
  eq(digest(db).dati_estratti.ricerca_subito.nuovo_tentativo, true, "in attesa di recupero");
});

Deno.test("11 · email rielaborata più volte e due email della stessa ricerca: nessuna importazione doppia", async () => {
  const db = fakeSupabase();
  const web = site([ids(0, 30), ids(30, 4)].map(list => list.map(id => ({ id, company: false }))));
  for (let run = 0; run < 3; run++) await cycle(db, [realEmail("e-1")], web.fetchPage);
  eq(cards(db).length, 34, "34 schede dopo tre esecuzioni");
  eq(db.tables.annunci_candidati_notifiche.filter((n: Any) => String(n.source_email_id).includes("#subito-")).length, 34, "una voce di storico per annuncio, nessuna ripetuta");
  eq(db.tables.annunci_candidati_notifiche.filter((n: Any) => n.source_email_id === "e-1").length, 1, "una sola voce per la scheda riepilogativa (notifica raggruppata)");
  eq(logs(db).length, 1, "una riga di registro per l'email");
  eq([logs(db)[0].nuove_opportunita, logs(db)[0].gia_in_opportunita], [0, 34], "ultima esecuzione: nessuna nuova, 34 già presenti");
  const db2 = fakeSupabase();
  const web2 = site([ids(0, 5).map(id => ({ id, company: false }))]);
  await cycle(db2, [realEmail("e-old", "Wed, 25 Nov 2026 08:24:00 +0000"), realEmail("e-new")], web2.fetchPage);
  eq(web2.requests.length, 1, "la ricerca è letta una sola volta nel ciclo");
  eq(cards(db2).length, 5, "nessun doppione");
  eq(logs(db2).find((log: Any) => log.gmail_message_id === "e-old").esito, "assorbita", "email più vecchia assorbita dalla più recente");
});

Deno.test("12 · errore durante la sincronizzazione: nessuna perdita, cursore fermo, completamento successivo senza doppioni", async () => {
  const [known] = ids(0, 1);
  const seed = { owner_id: OWNER, stato: "contattato", titolo: "Mio titolo", comune: "Ancona", dedup_key: "subito:" + known,
    listing_key: "subito.it/appartamenti/appartamento-prova-ancona-" + known + ".htm", source_email_id: "old", note: "Nota", dati_estratti: {} };
  const db = fakeSupabase({ annunci_candidati: [seed] });
  const web = site([ids(0, 10).map(id => ({ id, company: false }))]);
  let failOnce = true;
  db.state.fail = ((table, op, payload) => {
    if (failOnce && table === "annunci_candidati" && op === "insert" && payload?.dedup_key === "subito:" + ids(5, 1)[0]) { failOnce = false; return { message: "errore simulato" }; }
    return null;
  }) as FailRule;
  const first = await cycle(db, [realEmail("e-1")], web.fetchPage);
  eq(first.advanced, false, "cursore fermo");
  eq(logs(db).length, 0, "registro non scritto finché tutto non è salvato");
  eq(cards(db).find((row: Any) => row.dedup_key === "subito:" + known).note, "Nota", "dati esistenti intatti");
  const second = await cycle(db, [realEmail("e-1")], web.fetchPage);
  eq(second.advanced, true, "secondo ciclo completo");
  eq(cards(db).length, 10, "10 schede, nessuna doppia");
  // Errore di lettura durante il confronto con le Opportunità: nessuna scheda creata alla cieca.
  const db2 = fakeSupabase();
  db2.state.fail = ((table, op) => table === "annunci" && op === "select" ? { message: "lettura non riuscita" } : null) as FailRule;
  const blind = await cycle(db2, [realEmail("e-1")], web.fetchPage);
  eq([blind.advanced, cards(db2).length, blind.result.failures.length], [false, 0, 1], "confronto con l'Archivio non riuscito: nessuna scheda, cursore fermo");
  // Registro non salvabile (tabella assente o errore): il cursore non avanza.
  const db3 = fakeSupabase();
  db3.state.fail = ((table) => table === "nmre_subito_ricerche_sync" ? { message: "relation does not exist" } : null) as FailRule;
  const noLog = await cycle(db3, [realEmail("e-1")], web.fetchPage);
  eq(noLog.advanced, false, "senza registro il cursore non avanza");
});

Deno.test("ricerca vuota dichiarata da Subito: completa con zero annunci, nessun errore", async () => {
  const db = fakeSupabase();
  await cycle(db, [realEmail("e-1")], site([[]], { 1: { html: pageHtml([], { page: 1, totalPages: 0, total: 0 }) } }).fetchPage);
  eq([logs(db)[0].esito, cards(db).length], ["completa", 0], "completa, zero schede");
});

Deno.test("pagina senza numero di pagine: completa solo se mostra tutti i risultati dichiarati", async () => {
  const list = ids(0, 3).map(id => ({ id, company: false }));
  const full = await fetchWholeSubitoSearch(emailEntries([realEmail("e-1")])[0].digest,
    { fetchPage: url => Promise.resolve({ status: 200, finalUrl: url, html: pageHtml(list, { page: 1, totalPages: null, total: 3 }) }) }, { maxPages: 10 });
  eq([full.status, full.items.length], ["completa", 3], "tutti mostrati");
  const partial = await fetchWholeSubitoSearch(emailEntries([realEmail("e-1")])[0].digest,
    { fetchPage: url => Promise.resolve({ status: 200, finalUrl: url, html: pageHtml(list, { page: 1, totalPages: null, total: 40 }) }) }, { maxPages: 10 });
  eq([partial.status, partial.reason], ["parziale", "totale_non_dichiarato"], "non dimostrabile: parziale");
});

Deno.test("pagina reale del 26/11: 30 annunci letti, 9 pagine dichiarate, pagina 2 richiesta con gli stessi filtri", async () => {
  const requests: string[] = [];
  const fetched = await fetchWholeSubitoSearch(emailEntries([realEmail("e-1")])[0].digest, {
    fetchPage: url => { requests.push(url); return Promise.resolve(requests.length === 1 ? { status: 200, finalUrl: url, html: REAL_PAGE } : { status: 403, finalUrl: url, html: "" }); }
  }, { maxPages: 10 });
  eq([fetched.items.length, fetched.totalPages, fetched.status, fetched.reason], [30, 9, "parziale", "ricerca_parziale_bloccata"], "pagina 1 letta, pagina 2 non disponibile nei test");
  eq(new URL(requests[1]).searchParams.get("o"), "2", "pagina 2 con o=2");
  eq(new URL(requests[1]).searchParams.get("advt"), "0,2", "filtro mantenuto");
  eq(new URL(requests[1]).searchParams.get("kxconfid") !== null, true, "parametri della ricerca salvata mantenuti");
});

Deno.test("unificazione sicura (piano, nessuna scrittura): campi vuoti completati, valori diversi conservati, duplicato non cancellato", () => {
  const plan = planSubitoDuplicateMerge(
    { id: "a", titolo: "Titolo A", comune: null, prezzo: 150000, note: "Nota A", dati_estratti: { subito: { id: "700000001" } } },
    { id: "b", titolo: "Titolo B", comune: "Ancona", prezzo: 150000, note: "Nota B", contact_id: "c-9", dati_estratti: { subito: { id: "700000001" } } }
  );
  if (!plan.ok) throw new Error("piano atteso");
  eq(plan.fill, { comune: "Ancona", contact_id: "c-9" }, "campi vuoti completati, contatto conservato");
  eq(Object.keys(plan.conflicts).sort(), ["note", "titolo"], "valori diversi (note, titolo) conservati come alternative");
  eq([plan.moveNotifications, plan.deleteDuplicate], [true, false], "storico spostato, duplicato non cancellato");
  eq(missingFieldsPatch({ comune: "Osimo", prezzo: null, titolo: "Annuncio Subito 700000001", dati_estratti: {} }, { comune: "Ancona", prezzo: 1, titolo: "Bilocale" }, NOW),
    { prezzo: 1, titolo: "Bilocale", updated_at: NOW }, "completamento: solo campi vuoti e titolo provvisorio");
});
