// Test sui file reali di Subito (ripuliti da dati personali): l'email del 26/11/2026
// "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te" e la pagina dei risultati
// aperta dal pulsante. Usano il codice di produzione: conversione del messaggio Gmail e
// smistamento (_shared/mailbox.ts, chiamato da index.ts), recupero e righe dei candidati,
// salvataggio protetto, su un database simulato con i vincoli di unicità. Nessuna rete.
// Uso: deno test --allow-read=. supabase/functions/nmre-gmail-scheduled/subito_real_test.ts
import { classifyMailbox, emailFromGmailMessage, repairEmailId, sellerForEmail } from "./_shared/mailbox.ts";
import { identifyNewSubitoListings, parseSubitoResultsPage, parseSubitoDate, subitoAdId, subitoPageConfirmsSearch } from "./_shared/subito.ts";
import { subitoRowsForEmails, supabaseSubitoDeps } from "./_shared/subito_acquisition.ts";
import { newSaveCounters, saveCandidateRow } from "./_shared/save_candidate.ts";
import { assertAllRowsSaved, IncompleteSyncError, processRowsIsolated } from "./_shared/row_isolation.ts";
import { propertyEmailDecision, sellerClassificationDetails } from "./_shared/parser.ts";
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
const SUBJECT = "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te";
// Orari reali: email del 26/11 alle 09:24:27 (ora italiana) e precedente della stessa
// ricerca il 25/11 alle 09:24 (secondi non noti).
const DATE_26 = "Thu, 26 Nov 2026 08:24:27 +0000";
const PREVIOUS_25 = "2026-11-25T08:24:00.000Z";
// Pagina d'arrivo reale dopo il redirect di Subito (advt=0,2 → /da-privati/, kxconfid mantenuto).
const FINAL_URL = "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/da-privati/?kxconfid=kxtest001&order=datedesc";

const b64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
/** Messaggio come lo restituisce l'API Gmail (format=full), con le due parti reali. */
function gmailMessage(id: string, options: { subject?: string; date?: string; html?: string; text?: string } = {}) {
  return {
    id, labelIds: ["INBOX", "CATEGORY_UPDATES"],
    snippet: "Ci sono nuovi risultati per la tua ricerca! Ciao, ci sono 3 nuovi annunci per la ricerca che hai salvato.",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "Subito <noreply@subito.it>" },
        { name: "Subject", value: options.subject ?? SUBJECT },
        { name: "Date", value: options.date ?? DATE_26 },
        { name: "Message-ID", value: "<test-" + id + "@subito.example>" }
      ],
      parts: [
        { mimeType: "text/plain", body: { data: b64url(options.text ?? REAL_TEXT) } },
        { mimeType: "text/html", body: { data: b64url(options.html ?? REAL_HTML) } }
      ]
    }
  };
}
const REAL_EMAIL = emailFromGmailMessage(gmailMessage("real-26"));
const rawList = () => JSON.parse(REAL_PAGE.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)![1]).props.pageProps.initialState.items.originalList;

async function syncCycle(db: ReturnType<typeof fakeSupabase>, emails: Any[], page = REAL_PAGE, cursor = { value: "h1", next: "h2" }) {
  const { subitoDigestById } = classifyMailbox(emails);
  const calls: string[] = [];
  const counters = newSaveCounters();
  const cycle = await subitoRowsForEmails(
    emails.filter(e => subitoDigestById.has(String(e.id))).map(e => ({ email: e, digest: subitoDigestById.get(String(e.id))! })),
    supabaseSubitoDeps(db.client, OWNER, (url: string) => { calls.push(url); return Promise.resolve({ status: 200, finalUrl: FINAL_URL, html: page }); }),
    { owner: OWNER, classifySeller: text => sellerClassificationDetails(text), now: () => "2026-11-26T10:00:00.000Z", allowAutomatedPageFetch: true }
  );
  const failures = [...cycle.failures, ...await processRowsIsolated(cycle.rows, row => String(row.notification_source_id || row.source_email_id),
    async row => { await saveCandidateRow(db.client, OWNER, row, counters, () => "2026-11-26T10:00:00.000Z"); })];
  let advanced = false;
  try { assertAllRowsSaved(failures); cursor.value = cursor.next; advanced = true; } catch (error) { if (!(error instanceof IncompleteSyncError)) throw error; }
  return { counters, failures, advanced, calls, outcomes: cycle.outcomes };
}
const previousDigestRow = (key: string) => ({ owner_id: OWNER, stato: "da_verificare", titolo: "Ricerca salvata Subito · 25/11", dedup_key: "gmail:real-25",
  source_email_id: "real-25", data_pubblicazione: PREVIOUS_25, dati_fonte: { ricerca_subito: key }, dati_estratti: {} });
const SEARCH_KEY = "subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2";
const byAd = (db: Any, id: string) => db.tables.annunci_candidati.filter((row: Any) => String(row.listing_key || "").endsWith("-" + id + ".htm"));
const digestOf = (db: Any, id: string) => db.tables.annunci_candidati.find((row: Any) => row.dedup_key === "gmail:" + id);
// Annunci della pagina reale pubblicati tra il 25/11 09:24 e il 26/11 09:24.
const WINDOW_IDS = ["669796300", "669759841", "669743222", "669735500", "669729038", "669692985"];

// ---------- Email reale ----------
Deno.test("email reale: accettata e smistata come ricerca salvata (il filtro generico la scartava)", () => {
  eq(propertyEmailDecision(REAL_EMAIL).rule, "esclusione_nel_testo", "causa reale: 'Ricerca salvata:' nella parte di testo");
  const { subitoDigestById, filterRuleById } = classifyMailbox([REAL_EMAIL]);
  eq(filterRuleById.get("real-26"), "accettata", "email accettata dalla sincronizzazione");
  const digest = subitoDigestById.get("real-26")!;
  eq([digest.declaredCount, digest.searchLabel, digest.linkSource], [3, "Appartamenti a Ancona e provincia", "pulsante"], "riepilogo riconosciuto");
  eq(digest.searchUrl, "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&kxconfid=kxtest001&order=datedesc", "kxconfid conservato, utm_* rimossi");
  eq(digest.searchKey, SEARCH_KEY, "chiave stabile senza kxconfid");
  eq(digest.emailListingUrls.length, 0, "l'email reale non contiene schede");
  eq(sellerClassificationDetails([REAL_EMAIL.subject, REAL_EMAIL.snippet, REAL_EMAIL.bodyText].join(" ")).classification, "Privato", "il testo da solo verrebbe letto come venditore privato");
  eq(sellerForEmail("real-26", subitoDigestById, () => ({ classification: "Privato" })).classification, "Da verificare", "il riepilogo resta sempre 'Da verificare'");
  eq(repairEmailId("real-26#subito-669796300"), "real-26", "rielaborazione di un annuncio: si rilegge l'email riepilogativa");
});

// ---------- Pagina reale ----------
Deno.test("pagina reale: 30 risultati da items.originalList, dati uguali a quelli della pagina", () => {
  const page = parseSubitoResultsPage(REAL_PAGE);
  const raw = rawList();
  eq([page.status, page.source, page.items.length, page.total, page.skipped], ["ok", "next_data", 30, 263, 0], "pagina letta");
  for (const entry of raw) {
    const item = page.items.find(i => i.id === subitoAdId(entry.urls.default))!;
    const feature = (key: string) => entry.features?.[key]?.values?.[0]?.key ?? null;
    eq(item.url, entry.urls.default, "link diretto " + item.id);
    eq(item.title, entry.subject.replace(/\s+/g, " ").trim(), "titolo " + item.id);
    eq(item.price, feature("/price") === null ? null : Number(feature("/price")), "prezzo " + item.id);
    eq(item.location, entry.geo.town.value, "comune " + item.id);
    eq(item.surfaceMq, feature("/size") === null ? null : Number(feature("/size")), "superficie " + item.id);
    eq(item.rooms, feature("/room") === null ? null : Number(feature("/room")), "locali " + item.id);
    eq(item.images.length, (entry.images || []).length, "immagini " + item.id);
    eq(item.publishedAt, parseSubitoDate(entry.date), "data " + item.id);
    eq(item.advertiserCompany, entry.advertiser.company, "tipo di inserzionista " + item.id);
  }
  eq(page.items.filter(i => i.advertiserCompany === true).length, 4, "4 inserzionisti professionali: la ricerca advt=0,2 li comprende");
});
Deno.test("pagina reale: annunci in vetrina o promossi (galleryList, boostedItems) non contati", () => {
  const promo = { ...rawList()[1], subject: "Promosso", date: "2026-11-26 08:00:00", urls: { default: "https://www.subito.it/appartamenti/promosso-ancona-669899999.htm" } };
  const withPromo = REAL_PAGE.replace('"galleryList": []', '"galleryList": ' + JSON.stringify([promo])).replace('"boostedItems": []', '"boostedItems": ' + JSON.stringify([promo]));
  eq(withPromo.includes("669899999"), true, "annuncio promosso presente nei dati della pagina");
  const page = parseSubitoResultsPage(withPromo);
  eq([page.items.length, page.items.some(i => i.id === "669899999")], [30, false], "promosso escluso dai risultati");
});

// ---------- Finestra temporale e conteggio dichiarato ----------
Deno.test("email del 25/11 alle 09:24 e del 26/11: 6 annunci nella finestra contro 3 dichiarati → da verificare", () => {
  const decision = identifyNewSubitoListings({ declaredCount: 3, page: parseSubitoResultsPage(REAL_PAGE), emailListingUrls: [],
    emailDateIso: new Date(DATE_26).toISOString(), previousDigestIso: PREVIOUS_25 });
  eq(decision.certain, false, "novità non dimostrabile");
  eq(decision.reason, "conteggio_diverso", "il conteggio non corrisponde");
  eq([decision.windowCount, decision.windowPrivate, decision.windowProfessional], [6, 3, 3], "6 nella finestra: 3 privati e 3 professionisti");
  eq(decision.windowReposted, [], "nessun annuncio ripubblicato nella finestra");
  eq(decision.possibleItems.map(i => i.id), WINDOW_IDS, "i 6 annunci della finestra proposti per la verifica");
});
Deno.test("ciclo completo sui file reali: nessun inserimento non dimostrato, notifica da verificare con i 6 link", async () => {
  const db = fakeSupabase({ annunci_candidati: [previousDigestRow(SEARCH_KEY)] });
  const result = await syncCycle(db, [REAL_EMAIL]);
  eq(result.calls, ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&kxconfid=kxtest001&order=datedesc"], "pagina richiesta con kxconfid");
  eq(result.outcomes, { "da_verificare:conteggio_diverso": 1 }, "esito");
  eq(WINDOW_IDS.every(id => byAd(db, id).length === 0), true, "nessun annuncio inserito come nuovo");
  const notice = digestOf(db, "real-26")!;
  eq([notice.stato, notice.tipo_venditore, notice.url, notice.url_originale], ["da_verificare", "Da verificare", null,
    "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&kxconfid=kxtest001&order=datedesc"], "notifica conservata da verificare");
  const search = notice.dati_estratti.ricerca_subito;
  eq([search.annunci_dichiarati, search.annunci_in_finestra, search.annunci_in_finestra_privati, search.annunci_in_finestra_professionali], [3, 6, 3, 3], "dettaglio registrato per il titolare");
  eq(search.possibili.map((p: Any) => p.url), WINDOW_IDS.map(id => rawList().find((e: Any) => e.urls.default.endsWith("-" + id + ".htm")).urls.default), "link diretti dei 6 annunci");
  eq(result.advanced, true, "notifica salvata: le altre email non vengono bloccate");
});
Deno.test("prima email della ricerca (nessuna precedente in NMRE): nessun annuncio inserito", async () => {
  const db = fakeSupabase();
  const result = await syncCycle(db, [REAL_EMAIL]);
  eq(result.outcomes, { "da_verificare:nessuna_notifica_precedente": 1 }, "esito");
  eq(db.tables.annunci_candidati.length, 1, "solo la notifica da verificare");
});

// ---------- Scenari con gli annunci reali ----------
Deno.test("scenari reali: Opportunità, Scartati, Archivio manuale e con candidato, nuovi", async () => {
  // Variante dell'email reale che dichiara 6 nuovi annunci: con la finestra 25/11 09:24 →
  // 26/11 la novità è dimostrabile (6 trovati, 6 dichiarati, nessuna ripubblicazione).
  const six = emailFromGmailMessage(gmailMessage("real-26-sei", {
    subject: SUBJECT.replace("ha 3 nuovi", "ha 6 nuovi"), html: REAL_HTML.replace(/ci sono 3 nuovi risultati/i, "ci sono 6 nuovi risultati"), text: REAL_TEXT.replace("ci sono 3 nuovi", "ci sono 6 nuovi")
  }));
  const raw = rawList();
  const urlOf = (id: string) => raw.find((e: Any) => e.urls.default.endsWith("-" + id + ".htm")).urls.default;
  const keyOf = (id: string) => "subito.it" + new URL(urlOf(id)).pathname;
  const seed = [
    previousDigestRow(SEARCH_KEY),
    // Opportunità corretta a mano: titolo, prezzo, nota sul venditore, decisione.
    { owner_id: OWNER, stato: "da_verificare", titolo: "Piazza Diaz — è un affitto, non vendita (nota mia)", prezzo: 500, url: urlOf("669796300"), listing_key: keyOf("669796300"),
      dedup_key: "gmail:a1", source_email_id: "a1", seller_manual_override: true, tipo_venditore: "Privato", seller_evidence: "Telefonato il 26/11",
      dati_estratti: { campi_manuali: ["titolo", "prezzo"], storico_stato: [{ data: "2026-11-26T09:30:00Z", origine: "utente", azione: "verifica_venditore", motivo: "Telefonato" }] } },
    // Scartato, salvato con un altro titolo nel link: riconosciuto per ID.
    { owner_id: OWNER, stato: "scartato", titolo: "Passo Ripe", listing_key: "subito.it/appartamenti/passo-ripe-vecchio-titolo-669759841.htm", dedup_key: "gmail:a2", source_email_id: "a2",
      dati_estratti: { storico_stato: [{ data: "2026-11-25T20:00:00Z", origine: "utente", azione: "scartato", motivo: "Troppo lontano" }] } },
    // Archivio con candidato d'origine (stato reale "confermato").
    { owner_id: OWNER, stato: "confermato", annuncio_id: "ann-2", titolo: "Passetto (in Archivio)", listing_key: keyOf("669735500"), dedup_key: "gmail:a3", source_email_id: "a3", dati_estratti: {} }
  ];
  // Archivio: immobile inserito a mano, senza candidato.
  const archive = [{ id: "ann-9", owner_id: OWNER, titolo: "Monolocale Senigallia (inserito a mano)", url: urlOf("669743222"), deleted_at: null }];
  const db = fakeSupabase({ annunci_candidati: seed, annunci: archive } as Any);
  const snapshot = JSON.stringify(seed.map(row => [row.titolo, row.stato, (row as Any).prezzo ?? null, (row as Any).tipo_venditore ?? null, (row as Any).seller_evidence ?? null]));
  const archiveBefore = JSON.stringify(db.tables.annunci);
  const candidatesBefore = JSON.stringify(db.tables.annunci_candidati.slice(0, 4));
  const result = await syncCycle(db, [six]);
  eq(result.outcomes, { "completo:finestra_temporale": 1 }, "novità dimostrata dalla finestra");
  eq(result.failures, [], "nessun errore");
  // Nuovi: inseriti con il proprio link diretto, "Da verificare".
  for (const id of ["669729038", "669692985"]) {
    const rows = byAd(db, id);
    eq([rows.length, rows[0]?.url, rows[0]?.stato, rows[0]?.dedup_key], [1, urlOf(id), "da_verificare", "subito:" + id], "annuncio nuovo inserito " + id);
  }
  // Già presenti: nessun duplicato, nessuna sovrascrittura.
  for (const id of ["669796300", "669759841", "669735500"]) eq(byAd(db, id).length, 1, "nessun duplicato per " + id);
  eq(byAd(db, "669743222").length, 0, "immobile dell'Archivio inserito a mano: non duplicato");
  eq(JSON.stringify(db.tables.annunci_candidati.slice(0, 4).map((row: Any) => [row.titolo, row.stato, row.prezzo ?? null, row.tipo_venditore ?? null, row.seller_evidence ?? null])), snapshot,
    "titoli, prezzi, note, stati e decisioni manuali invariati");
  eq(db.tables.annunci_candidati[2].dati_estratti.storico_stato[0].motivo, "Troppo lontano", "scarto manuale conservato");
  eq(db.tables.annunci_candidati[2].dati_estratti.notifiche_dopo_scarto, undefined, "scartato: nessun contrassegno, scheda non modificata");
  eq(JSON.stringify(db.tables.annunci), archiveBefore, "Archivio non modificato");
  eq(JSON.stringify(db.tables.annunci_candidati.slice(0, 4)), candidatesBefore, "le 4 schede già presenti sono identiche campo per campo (compreso updated_at)");
  const notice = digestOf(db, "real-26-sei")!;
  eq(notice.dati_estratti.ricerca_subito.gia_in_archivio.map((entry: Any) => entry.id), ["669743222"], "annuncio dell'Archivio registrato nella notifica");
  eq(db.tables.annunci_candidati_notifiche.filter((n: Any) => String(n.source_email_id).startsWith("real-26-sei#")).length, 5, "notifiche tracciate per i 5 annunci con candidato");
  // Rilettura della stessa email: nessun duplicato.
  const again = await syncCycle(db, [six]);
  eq(again.counters.inserted, 0, "rilettura: nessun inserimento");
});

Deno.test("link a schede aggiunti all'email reale (annunci suggeriti): ignorati", async () => {
  const suggested = ["669308504", "669247300", "669131082"];
  // Inseriti fuori dagli altri link, prima dei saluti finali.
  const html = REAL_HTML.replace("Un saluto, lo staff di Subito", suggested.map(id => '<a href="https://www.subito.it/appartamenti/consigliato-ancona-' + id + '.htm">Potrebbe interessarti</a>').join(" ") + " Un saluto, lo staff di Subito");
  const email = emailFromGmailMessage(gmailMessage("real-26-sugg", { html }));
  const db = fakeSupabase({ annunci_candidati: [previousDigestRow(SEARCH_KEY)] });
  const result = await syncCycle(db, [email]);
  eq(classifyMailbox([email]).subitoDigestById.get("real-26-sugg")!.emailListingUrls.length, 3, "3 link a schede nell'email, come i 3 annunci dichiarati");
  eq(result.outcomes, { "da_verificare:conteggio_diverso": 1 }, "decisione basata solo sulla pagina");
  eq(suggested.every(id => byAd(db, id).length === 0), true, "annunci suggeriti non inseriti");
});

// ---------- Redirect reale di Subito ----------
Deno.test("redirect reale (?advt=0%2C2 → /da-privati/): stessa ricerca confermata dai filtri della pagina", async () => {
  const requested = "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&kxconfid=kxtest001&order=datedesc";
  eq(subitoPageConfirmsSearch(requested, REAL_PAGE), true, "la pagina dichiara advt=0,2, marche, vendita, appartamenti, ancona");
  // Pagina che dichiara un filtro diverso (solo privati): un'altra ricerca, nessun annuncio.
  const otherSearch = REAL_PAGE.replace('"advt": "0,2", "blc"', '"advt": "0", "blc"').replace('"filters": {"advt": "0,2"}', '"filters": {"advt": "0"}');
  eq(subitoPageConfirmsSearch(requested, otherSearch), false, "filtro diverso: ricerca diversa");
  const db = fakeSupabase({ annunci_candidati: [previousDigestRow(SEARCH_KEY)] });
  const result = await syncCycle(db, [REAL_EMAIL], otherSearch);
  eq(result.outcomes, { "errore:pagina_vuota": 1 }, "risultati di un'altra ricerca non usati");
  eq(db.tables.annunci_candidati.filter((row: Any) => String(row.dedup_key).startsWith("subito:")).length, 0, "nessun annuncio inserito");
});
