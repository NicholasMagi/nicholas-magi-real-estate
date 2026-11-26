// 12 · Dalla scheda NMRE all'annuncio originale Subito. Le righe sono costruite dal codice
// di produzione (subitoItemRow, subitoDigestRow) e le funzioni della scheda sono estratte
// da index.html (nmreCandidateListingUrl, nmreSubitoRecoveryHtml, isSpecificCandidateUrl).
// Uso: deno test --allow-read=. supabase/functions/nmre-gmail-scheduled/subito_frontend_test.ts
import { parseSubitoResultsPage, subitoAdId, subitoSavedSearchDigest } from "./_shared/subito.ts";
import { subitoDigestRow, subitoItemRow } from "./_shared/subito_acquisition.ts";
import type { SubitoAcquisition } from "./_shared/subito_acquisition.ts";
import { sellerClassificationDetails } from "./_shared/parser.ts";

function eq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
}
const html = await Deno.readTextFile(new URL("../../../index.html", import.meta.url));
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
const ui = new Function(["validUrl", "nmreCandidateListingLabel", "nmreCandidateListingUrl", "nmreSubitoRecoveryHtml", "isSpecificCandidateUrl"].map(grab).join("\n")
  + ";return {nmreCandidateListingLabel,nmreCandidateListingUrl,nmreSubitoRecoveryHtml,isSpecificCandidateUrl};")() as any;

const fixture = (name: string) => Deno.readTextFileSync(new URL("./fixtures/" + name, import.meta.url));
const emailHtml = fixture("subito_saved_search_email.html");
const email = { id: "19a1f0c2d3e4b5a6", date: "Thu, 26 Nov 2026 09:24:26 +0100", from: "Subito <noreply@subito.it>",
  subject: "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te", bodyHtml: emailHtml, bodyText: "" };
const digest = subitoSavedSearchDigest(email)!;
const page = parseSubitoResultsPage(fixture("subito_results_page.html"));
const ctx = { owner: "o1", email, digest, classifySeller: (t: string) => sellerClassificationDetails(t), nowIso: "2026-11-26T10:00:00.000Z" };
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]+)"/g)].map(match => match[1].replace(/&amp;/g, "&"));

Deno.test("12 · la scheda di un annuncio recuperato apre direttamente l'annuncio Subito", () => {
  for (const id of ["608812345", "608807711", "608799020"]) {
    const row = { id: "c-" + id, ...subitoItemRow(page.items.find(item => item.id === id)!, ctx, { pageSource: "next_data" }) };
    const url = ui.nmreCandidateListingUrl(row);
    eq(subitoAdId(url), id, "«Apri annuncio» porta all'annuncio " + id);
    eq(ui.nmreCandidateListingLabel(row), "Apri annuncio", "la scheda individuale è etichettata come annuncio");
    eq(url.startsWith("https://www.subito.it/appartamenti/"), true, "scheda dell'annuncio, non la ricerca");
    eq(ui.isSpecificCandidateUrl(url), true, "riconosciuto come link specifico (controllo qualità)");
    eq(/data-subito-item="\d+"/.test(ui.nmreSubitoRecoveryHtml(row)), true, "riferimento all'annuncio Subito nella scheda");
  }
});

Deno.test("12 · notifica da verificare: link a ogni annuncio plausibile e alla pagina dei risultati", () => {
  const acquisition: SubitoAcquisition = {
    status: "da_verificare", reason: "nessuna_notifica_precedente", items: [], archived: [], pageSource: "next_data", pageCount: 8, attempts: 1, retry: false,
    keepDigestRecord: true,
    decision: { certain: false, reason: "nessuna_notifica_precedente", newItems: [], possibleItems: page.items.slice(0, 4), windowCount: null, windowPrivate: null, windowProfessional: null, windowReposted: [] }
  };
  const row = { id: "d1", ...subitoDigestRow(ctx, acquisition) };
  const markup = ui.nmreSubitoRecoveryHtml(row);
  eq(/Recupero da verificare/.test(markup), true, "stato del recupero indicato chiaramente");
  eq(/Prima email di questa ricerca/.test(markup), true, "motivo spiegato");
  const links = hrefs(markup);
  eq(links.filter(link => subitoAdId(link)).length, 4, "un link diretto per ogni annuncio plausibile");
  eq(links.includes(digest.searchUrl!), true, "link alla pagina dei risultati");
  eq(ui.nmreCandidateListingUrl(row), digest.searchUrl, "il collegamento principale della notifica apre la pagina dei risultati");
  eq(ui.nmreCandidateListingLabel(row), "Apri ricerca Subito", "la pagina generale non viene etichettata come annuncio specifico");
  const listingLinks = links.filter(link => subitoAdId(link));
  eq(listingLinks.length, 4, "un link diretto per ogni annuncio plausibile");
  eq(listingLinks.every(link => !!subitoAdId(link)), true, "ogni collegamento agli annunci è specifico");
  eq(/Apri questo annuncio/.test(markup), true, "ogni risultato ha un'azione esplicita per aprire il proprio annuncio");
  eq(ui.isSpecificCandidateUrl(digest.searchUrl), false, "la pagina dei risultati non è presentata come annuncio specifico");
});

Deno.test("12 · nessun link non sicuro o esterno nella scheda", () => {
  const acquisition: SubitoAcquisition = {
    status: "da_verificare", reason: "date_non_disponibili", items: [], archived: [], pageSource: "link", pageCount: 2, attempts: 1, retry: false, keepDigestRecord: true,
    decision: { certain: false, reason: "date_non_disponibili", newItems: [], windowCount: null, windowPrivate: null, windowProfessional: null, windowReposted: [], possibleItems: [
      { ...page.items[0], url: "javascript:alert(1)" }, { ...page.items[1], url: "https://evil.example.com/appartamenti/x-608812345.htm" }, page.items[2]] }
  };
  const markup = ui.nmreSubitoRecoveryHtml({ ...subitoDigestRow(ctx, acquisition), titolo: '<img src=x onerror=alert(1)>' });
  eq(/javascript:|evil\.example/.test(markup), false, "link non Subito o non sicuri esclusi");
  eq(hrefs(markup).filter(link => subitoAdId(link)).length, 1, "resta solo il link Subito valido");
  eq(/<img/.test(markup), false, "nessun markup iniettato");
});

Deno.test("12 · notifica: dettaglio privati/professionisti, ripubblicati e annunci già nell'Archivio", () => {
  const acquisition: SubitoAcquisition = {
    status: "completo", reason: "finestra_temporale", items: [page.items[1]], pageSource: "next_data", pageCount: 8, attempts: 1, retry: false, keepDigestRecord: true,
    archived: [{ id: "608807711", url: page.items[2].url, title: "Quadrilocale", annuncio_id: "a1", eliminato: false },
      { id: "608799020", url: page.items[3].url, title: "Bilocale", annuncio_id: "a2", eliminato: true }],
    decision: { certain: true, reason: "finestra_temporale", newItems: [page.items[1]], possibleItems: [], windowCount: 3, windowPrivate: 2, windowProfessional: 1, windowReposted: [] }
  };
  const markup = ui.nmreSubitoRecoveryHtml({ ...subitoDigestRow(ctx, acquisition, [{ id: page.items[1].id, url: page.items[1].url, title: page.items[1].title }]) });
  eq(/individuati: 3 \(2 privati, 1 professionisti\)/.test(markup), true, "dettaglio per tipo di inserzionista");
  eq(/Già presenti nell’Archivio, non duplicati/.test(markup), true, "sezione degli annunci già nell'Archivio");
  eq(/già nell’Archivio/.test(markup) && /eliminato dall’Archivio/.test(markup), true, "stato nell'Archivio indicato");
  eq(hrefs(markup).filter(link => subitoAdId(link)).length, 3, "link diretti: recuperato e annunci dell'Archivio");
});
