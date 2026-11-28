// Email Subito di ricerca salvata con più annunci ("… ha 3 nuovi annunci per te").
// I test usano le funzioni di produzione chiamate da index.ts (riconoscimento, recupero,
// righe dei candidati, salvataggio protetto) su fixture HTML realistiche e su un database
// simulato in memoria con i vincoli di unicità di produzione. Nessuna rete.
// Uso: deno test --allow-read=. supabase/functions/nmre-gmail-scheduled/subito_test.ts
import {
  extractSavedSearchLink, identifyNewSubitoListings, parseSubitoResultsPage, subitoAdId, subitoSavedSearchDigest
} from "./_shared/subito.ts";
import { subitoItemRow, subitoRowsForEmails, supabaseSubitoDeps, SUBITO_MAX_ATTEMPTS } from "./_shared/subito_acquisition.ts";
import { newSaveCounters, saveCandidateRow } from "./_shared/save_candidate.ts";
import { assertAllRowsSaved, IncompleteSyncError, processRowsIsolated } from "./_shared/row_isolation.ts";
import { canonicalListingKey, propertyEmailDecision, sellerClassificationDetails } from "./_shared/parser.ts";
import { DATA_EXTRACTION_VERSION, isRepairEligible } from "./_shared/retention.ts";
import { fakeSupabase } from "./fake_supabase.ts";
import type { FakeRow, FailRule } from "./fake_supabase.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
function eq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
}
const fixture = (name: string) => Deno.readTextFileSync(new URL("./fixtures/" + name, import.meta.url));
const EMAIL_HTML = fixture("subito_saved_search_email.html");
const PAGE = fixture("subito_results_page.html");
const OWNER = "00000000-0000-4000-8000-000000000001";
// URL richiesto: kxconfid conservato, solo utm_* rimossi.
const SEARCH_URL = "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&kxconfid=u2p484vrw&order=datedesc";
const SUBJECT = "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te";
const NEW_IDS = ["608812345", "608807711", "608799020"];

// Stessa conversione HTML → testo di bodyParts() in index.ts.
function bodyText(html: string) {
  return html.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, " $1 ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");
}
function email(id: string, date: string, options: { html?: string; subject?: string; from?: string } = {}) {
  const html = options.html ?? EMAIL_HTML;
  return {
    id, date, from: options.from ?? "Subito <noreply@subito.it>", subject: options.subject ?? SUBJECT,
    snippet: "Nuovi annunci per te. Ci sono 3 nuovi risultati per la ricerca che hai salvato.",
    bodyText: bodyText(html), bodyHtml: html, labels: ["INBOX"]
  };
}
// Email reale del 26/11/2026 alle 09:24 (ora italiana) e la precedente della stessa ricerca.
const EMAIL_26 = email("19a1f0c2d3e4b5a6", "Thu, 26 Nov 2026 09:24:26 +0100");
const EMAIL_25 = email("19a0aa11bb22cc33", "Wed, 25 Nov 2026 09:22:00 +0100");

type Page = { status?: number; html?: string; error?: boolean; finalUrl?: string };
function pages(...sequence: Page[]) {
  const calls: string[] = [];
  let index = 0;
  const fetchPage = (url: string) => {
    calls.push(url);
    const page = sequence[Math.min(index++, sequence.length - 1)];
    if (page.error) return Promise.reject(new TypeError("error sending request: connection timed out"));
    return Promise.resolve({ status: page.status ?? 200, finalUrl: page.finalUrl ?? url, html: page.html ?? PAGE });
  };
  return { fetchPage, calls };
}

// Un ciclo di sincronizzazione per le email Subito, nello stesso ordine di index.ts:
// righe Subito → salvataggio isolato di ogni riga → verifica → cursore.
async function syncCycle(db: ReturnType<typeof fakeSupabase>, emails: Any[], fetchPage: Any, cursor = { value: "h1", next: "h2" }) {
  const entries = emails.map(e => ({ email: e, digest: subitoSavedSearchDigest(e)! })).filter(entry => entry.digest);
  const counters = newSaveCounters();
  const cycle = await subitoRowsForEmails(entries, supabaseSubitoDeps(db.client, OWNER, fetchPage), {
    owner: OWNER, classifySeller: text => sellerClassificationDetails(text), now: () => "2026-11-26T10:00:00.000Z", allowAutomatedPageFetch: true
  });
  const failures = [...cycle.failures, ...await processRowsIsolated(cycle.rows, row => String(row.notification_source_id || row.source_email_id),
    async row => { await saveCandidateRow(db.client, OWNER, row, counters, () => "2026-11-26T10:00:00.000Z"); })];
  let advanced = false;
  try {
    assertAllRowsSaved(failures);
    cursor.value = cursor.next;
    advanced = true;
  } catch (error) {
    if (!(error instanceof IncompleteSyncError)) throw error;
  }
  return { counters, failures, advanced, outcomes: cycle.outcomes, rows: cycle.rows };
}
const candidates = (db: ReturnType<typeof fakeSupabase>) => db.tables.annunci_candidati;
const byAd = (db: ReturnType<typeof fakeSupabase>, id: string) => candidates(db).filter(row => String(row.listing_key || "").endsWith("-" + id + ".htm"));
const digestOf = (db: ReturnType<typeof fakeSupabase>, gmailId: string) => candidates(db).find(row => row.dedup_key === "gmail:" + gmailId);

/** Stato dopo l'email del 25/11 (prima email di questa ricerca: notifica da verificare). */
async function afterPreviousDigest(seed: FakeRow[] = [], notices: FakeRow[] = [], archive: FakeRow[] = []) {
  const db = fakeSupabase({ annunci_candidati: seed, annunci_candidati_notifiche: notices, annunci: archive } as Any);
  await syncCycle(db, [EMAIL_25], pages({ html: PAGE }).fetchPage);
  return db;
}

// ---------- Autorizzazione lettura automatica ----------
Deno.test("Subito result-page acquisition is disabled by default and preserves the email digest", async () => {
  const db = fakeSupabase();
  const fetcher = pages({ html: PAGE });
  const entries = [{ email: EMAIL_26, digest: subitoSavedSearchDigest(EMAIL_26)! }];
  const cycle = await subitoRowsForEmails(entries, supabaseSubitoDeps(db.client, OWNER, fetcher.fetchPage), {
    owner: OWNER, classifySeller: text => sellerClassificationDetails(text), now: () => "2026-11-26T10:00:00.000Z"
  });
  eq(fetcher.calls.length, 0, "nessuna richiesta automatica alla pagina Subito");
  eq(cycle.rows.length, 1, "la notifica riepilogativa resta salvabile");
  eq(cycle.rows[0].dati_estratti.ricerca_subito.motivo, "autorizzazione_richiesta", "motivo esplicito");
  eq(cycle.rows[0].dati_estratti.ricerca_subito.nuovo_tentativo, false, "nessun retry automatico");
});

Deno.test("Subito: il comune viene classificato nella provincia corretta e le località ignote restano da verificare", () => {
  const base = { id: "700000001", url: "https://www.subito.it/appartamenti/prova-700000001.htm", title: "Appartamento", description: "Immobile in vendita", price: 150000, surfaceMq: 80, rooms: 3, images: [], publishedAt: null, advertiserCompany: false };
  const ctx = { owner: OWNER, email: EMAIL_26, digest: subitoSavedSearchDigest(EMAIL_26)!, nowIso: "2026-11-26T10:00:00.000Z", classifySeller: (text: string) => sellerClassificationDetails(text) };
  const ancona = subitoItemRow({ ...base, location: "Castelfidardo" }, ctx, { pageSource: "next_data" });
  const macerata = subitoItemRow({ ...base, location: "Camerino" }, ctx, { pageSource: "next_data" });
  const unknown = subitoItemRow({ ...base, location: null }, ctx, { pageSource: "next_data" });
  eq([ancona.dati_estratti.territorio, macerata.dati_estratti.territorio], ["Ancona", "Macerata"], "province riconosciute");
  eq([unknown.dati_estratti.territorio, unknown.tipo_venditore], ["Da verificare", "Da verificare"], "località non riconosciuta prudente");
});

// ---------- 1 · Riconoscimento ----------
Deno.test("1 · email Subito di ricerca salvata riconosciuta (numero dichiarato, nome della ricerca)", () => {
  const digest = subitoSavedSearchDigest(EMAIL_26)!;
  eq(digest !== null, true, "riconosciuta");
  eq(digest.declaredCount, 3, "3 nuovi annunci dichiarati");
  eq(digest.searchLabel, "Appartamenti a Ancona e provincia", "nome della ricerca");
  eq(digest.emailListingUrls.length, 0, "l'email non contiene schede");
  // Fixture sintetica (senza parte di testo): il filtro generico la escluderebbe per il link
  // del logo. Sull'email reale la causa è un'altra ("Ricerca salvata:" nella parte di testo):
  // vedi subito_real_test.ts.
  eq(propertyEmailDecision(EMAIL_26).rule, "link_principale_generico", "il filtro generico escludeva la fixture sintetica");
});
Deno.test("1 · non riconosciute: altri mittenti, mittenti che imitano Subito, avvisi di un singolo annuncio", () => {
  eq(subitoSavedSearchDigest(email("x1", "Thu, 26 Nov 2026 09:24:26 +0100", { from: "Immobiliare.it <noreply@immobiliare.it>" })), null, "altro portale");
  eq(subitoSavedSearchDigest(email("x2", "Thu, 26 Nov 2026 09:24:26 +0100", { from: "Subito <noreply@subito.it.example.com>" })), null, "dominio che imita Subito");
  const single = email("x3", "Thu, 26 Nov 2026 09:24:26 +0100", {
    subject: "Nuovo annuncio: Trilocale con balcone",
    html: '<p>È stato pubblicato un annuncio che potrebbe interessarti.</p><a href="https://www.subito.it/appartamenti/trilocale-ancona-608812345.htm">Vedi annuncio</a>'
  });
  eq(subitoSavedSearchDigest({ ...single, snippet: "È stato pubblicato un annuncio" }), null, "avviso di un singolo annuncio: percorso normale");
});

// ---------- 2 · Link del pulsante ----------
Deno.test("2 · link del pulsante «Vedi i nuovi annunci»: kxconfid conservato, solo utm_* rimossi, non il logo", () => {
  const link = extractSavedSearchLink(EMAIL_HTML);
  eq(link.source, "pulsante", "dal pulsante");
  eq(link.url, SEARCH_URL, "URL della ricerca: UTM rimossi, kxconfid conservato");
  eq(subitoSavedSearchDigest(EMAIL_26)!.searchKey, "subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2", "chiave stabile della ricerca");
  const changedToken = subitoSavedSearchDigest({ ...EMAIL_26, bodyHtml: EMAIL_HTML.replace("kxconfid=u2p484vrw", "kxconfid=token-diverso") });
  eq(changedToken?.searchKey, subitoSavedSearchDigest(EMAIL_26)!.searchKey, "kxconfid variabile non crea una nuova ricerca");
});
Deno.test("2 · stessa ricerca con kxconfid e campagna diversi: stessa chiave, kxconfid sempre nella richiesta", () => {
  const other = EMAIL_HTML.replace("kxconfid=u2p484vrw", "kxconfid=zz9other").replace("utm_content=20261126", "utm_content=20261127");
  const a = subitoSavedSearchDigest(EMAIL_26)!, b = subitoSavedSearchDigest(email("x9", "Fri, 27 Nov 2026 09:24:26 +0100", { html: other }))!;
  eq(a.searchKey, b.searchKey, "chiave della ricerca indipendente da kxconfid e campagna");
  eq(/kxconfid=zz9other/.test(b.searchUrl!), true, "kxconfid dell'email nella richiesta");
  eq(/utm_/.test(b.searchUrl!), false, "parametri di campagna rimossi dalla richiesta");
});
Deno.test("2 · pulsante con redirect di tracciamento, link alternativo, link mancante", () => {
  const tracked = EMAIL_HTML.replace(/href="https:\/\/www\.subito\.it\/annunci-marche[^"]+"/,
    'href="https://click.subito.it/track?url=' + encodeURIComponent("https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&kxconfid=u2p484vrw&order=datedesc&utm_source=knocker") + '"');
  eq(extractSavedSearchLink(tracked).url, SEARCH_URL, "redirect con URL annidato");
  const noButton = '<p>Ci sono 3 nuovi risultati</p><a href="https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&amp;utm_source=x">qui</a>';
  eq(extractSavedSearchLink(noButton).source, "altro_link", "senza pulsante: altro link alla ricerca");
  const missing = '<p>Ci sono 3 nuovi risultati</p><a href="https://t.example.com/abc">Vedi i nuovi annunci</a>';
  const result = extractSavedSearchLink(missing);
  eq(result.url, null, "link non riconoscibile: nessun URL inventato");
  eq(result.unresolved, "https://t.example.com/abc", "link del pulsante conservato per la verifica");
});

// ---------- 3 e 4 · Pagina dei risultati e link diretti ----------
Deno.test("3 · più annunci recuperati dalla pagina, con i dati disponibili", () => {
  const page = parseSubitoResultsPage(PAGE);
  eq(page.status, "ok", "pagina letta");
  eq(page.source, "next_data", "dati strutturati della pagina");
  eq(page.items.length, 8, "8 annunci nella pagina");
  const trilocale = page.items.find(item => item.id === "608812345")!;
  eq(trilocale.title, "Trilocale con balcone zona Adriatico", "titolo");
  eq(trilocale.price, 165000, "prezzo");
  eq(trilocale.location, "Ancona", "località");
  eq(trilocale.surfaceMq, 85, "superficie");
  eq(trilocale.rooms, 3, "locali");
  eq(/trilocale con balcone e cantina/i.test(trilocale.description || ""), true, "descrizione");
  eq(trilocale.images.length, 2, "immagini");
  eq(trilocale.publishedAt, "2026-11-26T06:58:10.000Z", "data di pubblicazione (ora italiana → UTC)");
  eq(trilocale.advertiserCompany, false, "inserzionista non professionale");
});
Deno.test("3 · solo items.originalList: annunci in vetrina e promossi (galleryList, boostedItems) esclusi", () => {
  const page = parseSubitoResultsPage(PAGE);
  eq(PAGE.includes("608899999"), true, "la fixture contiene un annuncio promosso recente");
  eq(page.items.some(item => item.id === "608899999"), false, "annuncio promosso non contato tra i risultati");
  eq(page.total, 214, "totale dichiarato dalla pagina");
  // Struttura diversa (elenco dei risultati assente): annunci solo proposti, mai certi.
  const moved = PAGE.replace('"originalList"', '"altroElenco"');
  const other = parseSubitoResultsPage(moved);
  eq(other.source, "next_data_generico", "struttura non riconosciuta");
  eq(identifyNewSubitoListings({ declaredCount: 3, page: other, emailListingUrls: [], emailDateIso: "2026-11-26T08:24:26.000Z", previousDigestIso: "2026-11-25T08:22:00.000Z" }).reason,
    "struttura_non_riconosciuta", "nessuna certezza se l'elenco dei risultati non è riconosciuto");
  // Una voce dell'elenco senza link valido: recupero parziale.
  const broken = parseSubitoResultsPage(PAGE.replace('"default": "https://www.subito.it/appartamenti/bilocale-arredato-centro-falconara-marittima-608799020.htm"', '"default": "https://www.subito.it/x"'));
  eq(broken.skipped, 1, "voce non leggibile contata");
  eq(identifyNewSubitoListings({ declaredCount: 3, page: broken, emailListingUrls: [], emailDateIso: "2026-11-26T08:24:26.000Z", previousDigestIso: "2026-11-25T08:22:00.000Z" }).reason,
    "dati_parziali", "voce non leggibile: recupero parziale, nessuna certezza");
});
Deno.test("4 · ogni annuncio ha il proprio link diretto e il proprio ID", () => {
  const page = parseSubitoResultsPage(PAGE);
  const ids = new Set(page.items.map(item => item.id));
  eq(ids.size, 8, "ID distinti");
  for (const item of page.items) {
    eq(/^https:\/\/www\.subito\.it\/appartamenti\/[a-z0-9-]+-\d{9}\.htm$/.test(item.url), true, "link diretto senza parametri: " + item.url);
    eq(subitoAdId(item.url), item.id, "ID dal link");
    eq(canonicalListingKey(item.url), "subito.it" + new URL(item.url).pathname, "chiave dell'immobile NMRE");
  }
  // Struttura diversa (solo schede, senza dati strutturati): link comunque recuperati.
  const links = parseSubitoResultsPage(fixture("subito_results_page_links_only.html"));
  eq(links.source, "link", "struttura diversa: soli link");
  eq(links.items.length, 8, "8 link diretti");
});

// ---------- 5 · Inserimento in Opportunità ----------
Deno.test("5 · i tre annunci nuovi diventano tre opportunità distinte e apribili", async () => {
  const db = await afterPreviousDigest();
  eq(digestOf(db, EMAIL_25.id)?.dati_estratti?.ricerca_subito?.motivo, "nessuna_notifica_precedente", "prima email della ricerca: da verificare");
  const before = candidates(db).length;
  const result = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage);
  eq(result.outcomes["completo:finestra_temporale"], 1, "nuovi annunci individuati con certezza");
  eq(result.counters.inserted, 3, "3 opportunità inserite");
  eq(candidates(db).length, before + 3, "nessuna riga in più (nessun riepilogo per un recupero completo)");
  for (const id of NEW_IDS) {
    const rows = byAd(db, id);
    eq(rows.length, 1, "un candidato per l'annuncio " + id);
    const row = rows[0];
    eq(row.stato, "da_verificare", "in Opportunità");
    eq(row.url, "https://www.subito.it" + new URL(row.url).pathname, "URL diretto");
    eq(subitoAdId(row.url), id, "URL dell'annuncio giusto");
    eq(row.dedup_key, "subito:" + id, "chiave per ID");
    eq(row.dati_fonte.source_email_id, EMAIL_26.id, "notifica originale tracciabile");
    eq("preserve_existing" in row || "subito_ad_id" in row || "notification_source_id" in row, false, "nessun campo interno salvato");
  }
  eq(result.advanced, true, "acquisizione completa: il cursore avanza");
  const notices = db.tables.annunci_candidati_notifiche.filter(n => String(n.source_email_id).startsWith(EMAIL_26.id + "#subito-"));
  eq(notices.length, 3, "una notifica per annuncio, collegata all'email originale");
  const trilocale = byAd(db, "608812345")[0];
  eq(trilocale.tipo_venditore, "Privato", "venditore dal testo dell'annuncio («Privato vende»)");
  eq(byAd(db, "608807711")[0].tipo_venditore, "Da verificare", "il filtro «Inserzionista: Privato» della ricerca non è una prova");
  eq(byAd(db, "608100200").length, 0, "annuncio in vetrina (vecchio) non inserito");
  eq(byAd(db, "608701234").length, 0, "annunci anteriori all'email precedente non inseriti");
});

// ---------- 6 · Deduplicazione per ID ----------
Deno.test("6 · annuncio già acquisito con un altro titolo nel link: riconosciuto per ID, nessun duplicato", async () => {
  const existing = { id: "existing-1", owner_id: OWNER, stato: "da_verificare", titolo: "Quadrilocale Pinocchio", url: "https://www.subito.it/appartamenti/quadrilocale-pinocchio-ancona-608807711.htm",
    listing_key: "subito.it/appartamenti/quadrilocale-pinocchio-ancona-608807711.htm", dedup_key: "gmail:single-1", source_email_id: "single-1",
    prezzo: 225000, dati_estratti: { storico_stato: [] }, data_pubblicazione: "2026-11-25T20:30:00.000Z" };
  const db = await afterPreviousDigest([existing], [{ owner_id: OWNER, candidate_id: "existing-1", source_email_id: "single-1",
    listing_price: 225000, notified_at: "2026-11-25T20:30:00.000Z" }]);
  const result = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage);
  eq(result.counters.inserted, 2, "solo i due annunci nuovi inseriti");
  eq(byAd(db, "608807711").length, 1, "un solo candidato per l'ID 608807711");
  const kept = byAd(db, "608807711")[0];
  eq(kept.titolo, "Quadrilocale Pinocchio", "dati dell'annuncio esistente non riscritti");
  eq(kept.url, existing.url, "URL esistente conservato");
  const linked = db.tables.annunci_candidati_notifiche.find(n => n.source_email_id === EMAIL_26.id + "#subito-608807711");
  eq(linked?.candidate_id, kept.id, "nuova notifica collegata all'annuncio esistente");
  eq(linked?.listing_price, 219000, "prezzo attuale registrato nello storico notifiche");
  eq(linked?.price_drop_percent, 2.67, "ribasso rispetto alla notifica precedente rilevato");
});

// ---------- 7 · Riletture ----------
Deno.test("7 · rilettura della stessa email e della stessa pagina: nessun duplicato", async () => {
  const db = await afterPreviousDigest();
  await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage);
  const snapshot = JSON.stringify({ c: candidates(db).map(r => [r.id, r.dedup_key, r.titolo, r.url]), n: db.tables.annunci_candidati_notifiche.length });
  for (let run = 0; run < 3; run++) {
    const again = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage);
    eq(again.counters.inserted, 0, "nessun inserimento alla rilettura " + (run + 1));
    eq(again.advanced, true, "rilettura completata");
  }
  eq(JSON.stringify({ c: candidates(db).map(r => [r.id, r.dedup_key, r.titolo, r.url]), n: db.tables.annunci_candidati_notifiche.length }), snapshot, "candidati e notifiche invariati");
  // Email successiva della stessa ricerca con la stessa pagina: nessun annuncio nuovo nella finestra.
  const later = email("19a2000000000001", "Thu, 26 Nov 2026 15:00:00 +0100", { subject: "Appartamenti a Ancona e provincia ha 1 nuovo annuncio per te" });
  const third = await syncCycle(db, [later], pages({ html: PAGE }).fetchPage);
  eq(third.counters.inserted, 1, "solo la notifica da verificare (nessun annuncio duplicato)");
  eq(digestOf(db, later.id)?.dati_estratti?.ricerca_subito?.motivo, "conteggio_diverso", "1 dichiarato, 0 trovati: da verificare");
  for (const id of NEW_IDS) eq(byAd(db, id).length, 1, "ancora un solo candidato per " + id);
});

// ---------- 8 · Annunci già in archivio ----------
Deno.test("8 · annunci già presenti in archivio o scartati: non reinseriti né modificati, notifica tracciata", async () => {
  // Stato reale di un candidato archiviato: "confermato", con il collegamento all'Archivio.
  const archived = { owner_id: OWNER, stato: "confermato", annuncio_id: "ann-1", titolo: "Trilocale Adriatico (archiviato)", url: "https://www.subito.it/appartamenti/trilocale-con-balcone-zona-adriatico-ancona-608812345.htm",
    listing_key: "subito.it/appartamenti/trilocale-con-balcone-zona-adriatico-ancona-608812345.htm", dedup_key: "gmail:old-a", source_email_id: "old-a", dati_estratti: {} };
  const discarded = { owner_id: OWNER, stato: "scartato", titolo: "Bilocale Falconara", url: "https://www.subito.it/appartamenti/bilocale-arredato-centro-falconara-marittima-608799020.htm",
    listing_key: "subito.it/appartamenti/bilocale-arredato-centro-falconara-marittima-608799020.htm", dedup_key: "gmail:old-b", source_email_id: "old-b",
    dati_estratti: { storico_stato: [{ data: "2026-11-25T19:00:00Z", origine: "utente", azione: "scartato", motivo: "Zona non interessante" }] } };
  const db = await afterPreviousDigest([archived, discarded]);
  const existingBefore = JSON.stringify(db.tables.annunci_candidati.filter((row: Any) => row.dedup_key === "gmail:old-a" || row.dedup_key === "gmail:old-b"));
  const result = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage);
  eq(JSON.stringify(db.tables.annunci_candidati.filter((row: Any) => row.dedup_key === "gmail:old-a" || row.dedup_key === "gmail:old-b")), existingBefore,
    "archiviato e scartato identici campo per campo (compreso updated_at)");
  eq(result.counters.inserted, 1, "inserito solo l'annuncio non ancora acquisito");
  eq(byAd(db, "608812345")[0].stato, "confermato", "l'archiviato resta archiviato");
  eq(byAd(db, "608812345")[0].titolo, "Trilocale Adriatico (archiviato)", "dati dell'archiviato invariati");
  const bilocale = byAd(db, "608799020")[0];
  eq(bilocale.stato, "scartato", "lo scarto manuale resta");
  eq(bilocale.dati_estratti.storico_stato[0].motivo, "Zona non interessante", "decisione manuale conservata");
  // Decisione del titolare: un annuncio Subito già presente non viene modificato in alcun modo
  // (nemmeno con il contrassegno di una nuova notifica); la notifica resta nello storico.
  eq(bilocale.dati_estratti.notifiche_dopo_scarto, undefined, "scheda scartata non modificata (nessun contrassegno)");
  eq(db.tables.annunci_candidati_notifiche.filter(n => String(n.source_email_id).startsWith(EMAIL_26.id)).length, 3, "tutte e tre le notifiche tracciate");
});

Deno.test("8 · immobile nell'Archivio inserito a mano (tabella annunci, senza candidato): non duplicato, esito tracciato", async () => {
  const manual = { owner_id: OWNER, titolo: "Bilocale Falconara — inserito a mano", url: "https://www.subito.it/appartamenti/bilocale-arredato-centro-falconara-marittima-608799020.htm?utm_source=app", deleted_at: null };
  const trashed = { owner_id: OWNER, titolo: "Quadrilocale eliminato dall'Archivio", url: "https://www.subito.it/appartamenti/quadrilocale-ristrutturato-pinocchio-ancona-608807711.htm", deleted_at: "2026-11-20T10:00:00.000Z" };
  const db = await afterPreviousDigest([], [], [manual, trashed]);
  const archiveBefore = JSON.stringify(db.tables.annunci);
  const result = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage);
  eq(result.counters.inserted, 2, "inseriti solo il nuovo annuncio e la notifica riepilogativa");
  eq(byAd(db, "608812345").length, 1, "annuncio realmente nuovo inserito");
  eq(byAd(db, "608799020").length, 0, "immobile dell'Archivio non duplicato in Opportunità");
  eq(byAd(db, "608807711").length, 0, "immobile eliminato dall'Archivio non reinserito (decisione manuale)");
  const digest = digestOf(db, EMAIL_26.id)!;
  eq(digest.dati_estratti.ricerca_subito.stato, "completo", "recupero completato");
  eq(digest.dati_estratti.ricerca_subito.gia_in_archivio.map((entry: Any) => entry.id + ":" + entry.eliminato_dall_archivio).sort().join(","),
    "608799020:false,608807711:true", "annunci riconosciuti nell'Archivio registrati nella notifica");
  eq(JSON.stringify(db.tables.annunci), archiveBefore, "Archivio non modificato");
});
Deno.test("8 · confronto con l'Archivio non riuscito: nessun annuncio classificato come nuovo, cursore fermo", async () => {
  const db = await afterPreviousDigest();
  db.state.fail = (table) => table === "annunci" ? { message: "permission denied for table annunci" } : null;
  const cursor = { value: "h1", next: "h2" };
  const result = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage, cursor);
  eq(result.rows.length, 0, "nessuna riga prodotta");
  eq(NEW_IDS.every(id => byAd(db, id).length === 0), true, "nessun annuncio inserito come nuovo");
  eq(result.failures[0]?.sourceEmailId, EMAIL_26.id, "email indicata come non elaborata");
  eq(cursor.value, "h1", "il cursore Gmail non avanza: l'email verrà rielaborata");
  db.state.fail = null;
  const retry = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage, cursor);
  eq(retry.counters.inserted, 3, "al ciclo successivo, con il confronto riuscito, i 3 annunci vengono inseriti");
  eq(cursor.value, "h2", "cursore avanzato solo ora");
});

// ---------- 9 · Modifiche manuali ----------
Deno.test("9 · modifiche manuali mai sovrascritte (annuncio e notifica da verificare)", async () => {
  const manual = { owner_id: OWNER, stato: "da_verificare", titolo: "Trilocale Adriatico — visto, proprietario Rossi", prezzo: 158000, comune: "Ancona (Adriatico)",
    url: "https://www.subito.it/appartamenti/trilocale-con-balcone-zona-adriatico-ancona-608812345.htm", listing_key: "subito.it/appartamenti/trilocale-con-balcone-zona-adriatico-ancona-608812345.htm",
    dedup_key: "subito:608812345", source_email_id: "19a1f0c2d3e4b5a6#subito-608812345", seller_manual_override: true, tipo_venditore: "Privato",
    dati_estratti: { campi_manuali: ["titolo", "prezzo", "comune"], storico_stato: [{ data: "2026-11-26T09:40:00Z", origine: "utente", azione: "verifica_venditore", motivo: "Telefonato" }] } };
  const db = await afterPreviousDigest([manual]);
  await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage);
  const row = byAd(db, "608812345")[0];
  eq(row.titolo, manual.titolo, "titolo corretto a mano conservato");
  eq(row.prezzo, 158000, "prezzo corretto a mano conservato");
  eq(row.comune, manual.comune, "comune corretto a mano conservato");
  eq(row.tipo_venditore, "Privato", "verifica manuale del venditore conservata");
  eq(row.dati_estratti.storico_stato.length, 1, "storico manuale intatto");
  // Notifica da verificare corretta a mano, poi rielaborata dopo un errore.
  const db2 = fakeSupabase();
  await syncCycle(db2, [EMAIL_26], pages({ status: 403, html: fixture("subito_results_page_captcha.html") }).fetchPage);
  const digest = digestOf(db2, EMAIL_26.id)!;
  Object.assign(digest, { titolo: "Ricerca Ancona — controllare lunedì", updated_at: "2026-11-26T11:00:00.000Z",
    dati_estratti: { ...digest.dati_estratti, campi_manuali: ["titolo"] } });
  await syncCycle(db2, [EMAIL_26], pages({ html: PAGE }).fetchPage);
  eq(digestOf(db2, EMAIL_26.id)!.titolo, "Ricerca Ancona — controllare lunedì", "titolo della notifica corretto a mano conservato");
});

// ---------- 10 · Errori e recupero parziale ----------
Deno.test("10 · pagina protetta da CAPTCHA, errore di rete, errore HTTP, pagina vuota: notifica conservata e ritentata", async () => {
  const cases: Array<[string, Page]> = [
    ["pagina_bloccata", { status: 403, html: fixture("subito_results_page_captcha.html") }],
    ["pagina_bloccata", { status: 200, html: fixture("subito_results_page_captcha.html") }],
    ["errore_rete", { error: true }],
    ["errore_http", { status: 503, html: "<html><body>Service Unavailable</body></html>" }],
    ["pagina_vuota", { status: 200, html: fixture("subito_results_page_empty.html") }]
  ];
  for (const [reason, page] of cases) {
    const db = fakeSupabase();
    const result = await syncCycle(db, [EMAIL_26], pages(page).fetchPage);
    const digest = digestOf(db, EMAIL_26.id)!;
    eq(digest.dati_estratti.ricerca_subito.stato, "errore", reason + ": non risulta completato");
    eq(digest.dati_estratti.ricerca_subito.motivo, reason, reason + ": motivo registrato");
    eq(digest.stato, "da_verificare", reason + ": notifica conservata in Opportunità");
    eq(digest.tipo_venditore, "Da verificare", reason + ": mai «Privato» (niente archiviazione automatica)");
    eq(digest.data_extraction_version, DATA_EXTRACTION_VERSION - 1, reason + ": rielaborazione programmata");
    eq(isRepairEligible(digest as Any), true, reason + ": idonea alla rilettura");
    eq(candidates(db).length, 1, reason + ": nessun annuncio inventato");
    eq(result.advanced, true, reason + ": notifica salvata, le altre email non vengono bloccate");
  }
});
Deno.test("10 · redirect Subito che perde i filtri: non acquisisce annunci di un'altra ricerca", async () => {
  const db = fakeSupabase();
  const redirected = pages({
    finalUrl: "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?order=datedesc"
  });
  const result = await syncCycle(db, [EMAIL_26], redirected.fetchPage);
  const digest = digestOf(db, EMAIL_26.id)!;
  eq(digest.dati_estratti.ricerca_subito.stato, "errore", "redirect non equivalente: errore");
  eq(digest.dati_estratti.ricerca_subito.motivo, "pagina_vuota", "redirect con filtri persi: da verificare");
  eq(candidates(db).filter(row => String(row.dedup_key || "").startsWith("subito:")).length, 0, "nessun annuncio da ricerca diversa");
  eq(result.advanced, true, "la notifica di errore è stata salvata e può essere ritentata");
});
Deno.test("10 · redirect Subito con solo kxconfid diverso: la stessa ricerca resta valida", async () => {
  const db = await afterPreviousDigest();
  const redirected = pages({
    finalUrl: "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&kxconfid=token-ruotato&order=datedesc"
  });
  const result = await syncCycle(db, [EMAIL_26], redirected.fetchPage);
  eq(result.counters.inserted, 3, "stessa ricerca: i tre annunci vengono recuperati");
  eq(digestOf(db, EMAIL_26.id), undefined, "nessuna notifica riepilogativa superflua");
});
Deno.test("10 · recupero parziale o incerto: nessuna opportunità certa, annunci plausibili da verificare", async () => {
  // Struttura diversa: soli link, senza date → impossibile sapere quali sono i nuovi.
  let db = await afterPreviousDigest();
  await syncCycle(db, [EMAIL_26], pages({ html: fixture("subito_results_page_links_only.html") }).fetchPage);
  let digest = digestOf(db, EMAIL_26.id)!;
  eq(digest.dati_estratti.ricerca_subito.stato, "da_verificare", "soli link: da verificare");
  eq(digest.dati_estratti.ricerca_subito.motivo, "date_non_disponibili", "motivo");
  eq(digest.dati_estratti.ricerca_subito.possibili.length, 8, "link plausibili proposti");
  eq(NEW_IDS.every(id => byAd(db, id).length === 0), true, "nessun annuncio inserito come certo");
  // Un annuncio senza data: recupero parziale.
  const partial = PAGE.replace('"date": "2026-11-25 21:14:02"', '"date": null');
  db = await afterPreviousDigest();
  await syncCycle(db, [EMAIL_26], pages({ html: partial }).fetchPage);
  eq(digestOf(db, EMAIL_26.id)!.dati_estratti.ricerca_subito.motivo, "dati_parziali", "data mancante: recupero parziale");
  eq(NEW_IDS.every(id => byAd(db, id).length === 0), true, "parziale: nessun annuncio certo");
  // Un annuncio non più disponibile: 2 trovati invece di 3.
  const removed = parseSubitoResultsPage(PAGE);
  removed.items = removed.items.filter(item => item.id !== "608807711");
  const decision = identifyNewSubitoListings({ declaredCount: 3, page: removed, emailListingUrls: [], emailDateIso: "2026-11-26T08:24:26.000Z", previousDigestIso: "2026-11-25T08:22:00.000Z" });
  eq(decision.certain, false, "annuncio rimosso: nessuna corrispondenza inventata");
  eq(decision.reason, "conteggio_diverso", "motivo: conteggio diverso");
  eq(decision.possibleItems.map(item => item.id).join(","), "608812345,608799020", "i due annunci rimasti proposti per la verifica");
  // Pagina che non arriva all'email precedente: potrebbero esserci altri risultati.
  const truncated = parseSubitoResultsPage(PAGE);
  truncated.items = truncated.items.filter(item => NEW_IDS.includes(item.id));
  eq(identifyNewSubitoListings({ declaredCount: 3, page: truncated, emailListingUrls: [], emailDateIso: "2026-11-26T08:24:26.000Z", previousDigestIso: "2026-11-25T08:22:00.000Z" }).reason,
    "pagina_incompleta", "finestra non completa: da verificare");
  // Link mancante nell'email: notifica conservata, nessun tentativo inutile.
  const noLink = email("19a1nolink000001", "Thu, 26 Nov 2026 09:24:26 +0100", { html: EMAIL_HTML.replace(/<a href="https:\/\/www\.subito\.it\/annunci-marche[^>]+>/, '<a href="mailto:x@example.com">') });
  db = fakeSupabase();
  const missing = pages({ html: PAGE });
  await syncCycle(db, [noLink], missing.fetchPage);
  digest = digestOf(db, noLink.id)!;
  eq(digest.dati_estratti.ricerca_subito.motivo, "link_mancante", "link mancante registrato");
  eq(digest.dati_estratti.ricerca_subito.nuovo_tentativo, false, "nessun nuovo tentativo (l'email non cambia)");
  eq(missing.calls.length, 0, "nessuna pagina richiesta");
});
Deno.test("10 · tentativi limitati: dopo " + SUBITO_MAX_ATTEMPTS + " errori la notifica resta da verificare senza altri tentativi", async () => {
  const db = fakeSupabase();
  const blocked = pages({ status: 403, html: fixture("subito_results_page_captcha.html") });
  for (let attempt = 1; attempt <= SUBITO_MAX_ATTEMPTS; attempt++) await syncCycle(db, [EMAIL_26], blocked.fetchPage);
  const digest = digestOf(db, EMAIL_26.id)!;
  eq(digest.dati_estratti.ricerca_subito.tentativi, SUBITO_MAX_ATTEMPTS, "tentativi contati");
  eq(digest.dati_estratti.ricerca_subito.nuovo_tentativo, false, "nessun altro tentativo automatico");
  eq(digest.data_extraction_version, DATA_EXTRACTION_VERSION, "non più idonea alla rilettura automatica");
  eq(digest.stato, "da_verificare", "resta in Opportunità per il controllo manuale");
  eq(candidates(db).length, 1, "un solo record per la notifica");
});

// ---------- 11 · Nessun completamento se il recupero non è riuscito ----------
Deno.test("11 · errore di salvataggio di un annuncio: cursore fermo, poi completamento senza duplicati", async () => {
  const db = await afterPreviousDigest();
  const failOnce: { done: boolean } = { done: false };
  const rule: FailRule = (table, op, payload) => {
    if (!failOnce.done && table === "annunci_candidati" && op === "insert" && payload?.dedup_key === "subito:608807711") {
      failOnce.done = true;
      return { code: "57014", message: "canceling statement due to statement timeout" };
    }
    return null;
  };
  db.state.fail = rule;
  const cursor = { value: "h1", next: "h2" };
  const first = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage, cursor);
  eq(first.advanced, false, "acquisizione non completata");
  eq(cursor.value, "h1", "il cursore Gmail non avanza");
  eq(first.failures.map(f => f.sourceEmailId).join(","), EMAIL_26.id + "#subito-608807711", "annuncio non salvato indicato");
  eq(first.counters.inserted, 2, "gli altri annunci sono salvati");
  const second = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage, cursor);
  eq(second.advanced, true, "completata al ciclo successivo");
  eq(cursor.value, "h2", "cursore avanzato solo ora");
  eq(NEW_IDS.every(id => byAd(db, id).length === 1), true, "un solo candidato per annuncio");
});
Deno.test("11 · errore di database durante il recupero: nessuna riga, cursore fermo", async () => {
  const db = await afterPreviousDigest();
  db.state.fail = (table, op) => table === "annunci_candidati" && op === "select" ? { message: "connection reset" } : null;
  const cursor = { value: "h1", next: "h2" };
  const result = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage, cursor);
  eq(result.rows.length, 0, "nessuna riga prodotta");
  eq(result.failures[0]?.sourceEmailId, EMAIL_26.id, "email non elaborata indicata");
  eq(cursor.value, "h1", "il cursore Gmail non avanza");
});
Deno.test("11 · recupero non riuscito, poi riuscito alla rilettura: annunci inseriti e notifica aggiornata come completata", async () => {
  const db = await afterPreviousDigest();
  await syncCycle(db, [EMAIL_26], pages({ error: true }).fetchPage);
  eq(digestOf(db, EMAIL_26.id)!.dati_estratti.ricerca_subito.stato, "errore", "primo tentativo: errore, non completato");
  eq(NEW_IDS.every(id => byAd(db, id).length === 0), true, "nessun annuncio dichiarato recuperato");
  const retry = await syncCycle(db, [EMAIL_26], pages({ html: PAGE }).fetchPage);
  eq(retry.counters.inserted, 3, "rilettura: 3 annunci inseriti");
  const digest = digestOf(db, EMAIL_26.id)!;
  eq(digest.dati_estratti.ricerca_subito.stato, "completo", "notifica aggiornata come completata");
  eq(digest.dati_estratti.ricerca_subito.recuperati.length, 3, "annunci recuperati elencati");
  eq(digest.data_extraction_version, DATA_EXTRACTION_VERSION, "nessuna altra rilettura");
});
Deno.test("11 · limite di pagine per ciclo: le email in eccesso sono rinviate senza consumare tentativi", async () => {
  const db = fakeSupabase();
  const list = Array.from({ length: 3 }, (_v, index) => email("19a9" + index, "Thu, 26 Nov 2026 0" + (index + 1) + ":00:00 +0100"));
  const fetcher = pages({ html: PAGE });
  const entries = list.map(e => ({ email: e, digest: subitoSavedSearchDigest(e)! }));
  const cycle = await subitoRowsForEmails(entries, supabaseSubitoDeps(db.client, OWNER, fetcher.fetchPage), { owner: OWNER, classifySeller: t => sellerClassificationDetails(t), maxPages: 2 });
  eq(fetcher.calls.length, 2, "2 pagine lette");
  const deferred = cycle.rows.find(row => row.dedup_key === "gmail:19a92")!;
  eq(deferred.dati_estratti.ricerca_subito.motivo, "rinviato", "terza email rinviata");
  eq(deferred.dati_estratti.ricerca_subito.tentativi, 0, "nessun tentativo consumato");
  eq(deferred.data_extraction_version, DATA_EXTRACTION_VERSION - 1, "riletta al ciclo successivo");
});

// ---------- Link a schede nell'email (per esempio annunci consigliati) ----------
Deno.test("4 · link a schede nell'email (annunci suggeriti): mai considerati nuovi, nemmeno se il numero coincide", async () => {
  const suggested = ["608100200", "608701234", "608655555"];
  const html = EMAIL_HTML.replace("Ricevi questa email", suggested.map(id => '<a href="https://www.subito.it/appartamenti/consigliato-ancona-' + id + '.htm?utm_source=knocker">Potrebbe interessarti</a>').join("") + "Ricevi questa email");
  const withSuggestions = email("19a1withlinks0001", "Thu, 26 Nov 2026 09:24:26 +0100", { html });
  eq(subitoSavedSearchDigest(withSuggestions)!.emailListingUrls.length, 3, "3 link a schede nell'email, come i 3 annunci dichiarati");
  // Pagina non raggiungibile: senza la pagina nessun annuncio può risultare nuovo.
  let db = fakeSupabase();
  let result = await syncCycle(db, [withSuggestions], pages({ error: true }).fetchPage);
  eq(result.counters.inserted, 1, "solo la notifica da verificare");
  eq(suggested.every(id => byAd(db, id).length === 0), true, "annunci suggeriti non inseriti");
  eq(digestOf(db, withSuggestions.id)!.dati_estratti.ricerca_subito.stato, "errore", "recupero non riuscito, non completato");
  // Pagina letta e finestra coerente: nuovi gli annunci della finestra, non i suggeriti.
  db = await afterPreviousDigest();
  result = await syncCycle(db, [withSuggestions], pages({ html: PAGE }).fetchPage);
  eq(NEW_IDS.every(id => byAd(db, id).length === 1), true, "inseriti i 3 annunci della finestra");
  eq(suggested.every(id => byAd(db, id).length === 0), true, "annunci suggeriti ignorati");
  eq(digestOf(db, withSuggestions.id), undefined, "recupero completo senza riepilogo");
});

Deno.test("annunci ripubblicati nella finestra: nessuna certezza, proposti per la verifica", () => {
  const page = parseSubitoResultsPage(PAGE);
  // 608590002 (20/11) ripubblicato il 26/11: data nuova, ID più vecchio di annunci anteriori alla finestra.
  const reposted = { ...page, items: page.items.map(item => item.id === "608590002" ? { ...item, publishedAt: "2026-11-26T07:00:00.000Z" } : item)
    .filter(item => item.id !== "608799020") };
  const decision = identifyNewSubitoListings({ declaredCount: 3, page: reposted, emailListingUrls: [], emailDateIso: "2026-11-26T08:24:26.000Z", previousDigestIso: "2026-11-25T08:22:00.000Z" });
  eq(decision.certain, false, "conteggio coincidente ma un annuncio è ripubblicato: nessuna certezza");
  eq(decision.reason, "possibili_ripubblicazioni", "motivo");
  eq(decision.windowReposted.join(","), "608590002", "annuncio ripubblicato indicato");
  eq(decision.possibleItems.some(item => item.id === "608590002"), true, "proposto per la verifica");
});
