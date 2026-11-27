// Test dell'importazione assistita da una pagina Subito aperta nel browser.
// Le funzioni pure vengono estratte da index.html: nessuna chiamata a Supabase e nessuna scrittura.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.notEqual(start, -1, "Funzione presente: " + startMarker);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(end, -1, "Confine della funzione presente: " + endMarker);
  return html.slice(start, end).trim();
}

const adIdSource = sourceBetween(
  "function nmreSubitoBrowserAdId(value){",
  "function nmreParseSubitoBrowserPayload(value){"
);
const parseSource = sourceBetween(
  "function nmreParseSubitoBrowserPayload(value){",
  "function nmreBuildSubitoBrowserCandidate(item,meta,ownerId,batchId){"
);
const buildSource = sourceBetween(
  "function nmreBuildSubitoBrowserCandidate(item,meta,ownerId,batchId){",
  "let nmreSubitoBrowserPreviewState=null;"
);

function validUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const getAdId = new Function(adIdSource + "\nreturn nmreSubitoBrowserAdId;")();
assert.equal(getAdId("https://www.subito.it/appartamenti/citt%C3%A0-669796300.htm"), "669796300");

const parse = new Function(
  "validUrl",
  adIdSource + "\n" + parseSource + "\nreturn nmreParseSubitoBrowserPayload;"
)(validUrl);
const build = new Function(buildSource + "\nreturn nmreBuildSubitoBrowserCandidate;")();

const searchUrl = "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/da-privati/?kxconfid=test&order=datedesc";
const payload = {
  source: "nmre-subito-browser-v1",
  captured_at: "2026-11-26T21:26:24.000Z",
  search_url: searchUrl,
  total: 30,
  items: [
    {
      id: "669796300",
      url: "https://www.subito.it/appartamenti/piazza-diaz-ancona-669796300.htm",
      title: "PIAZZA DIAZ",
      description: "Descrizione di prova",
      price: 180000,
      location: "Ancona",
      surface_mq: 95,
      rooms: 4,
      images: ["https://images.example.test/photo.jpg", "javascript:alert(1)"],
      published_at: "2026-11-26T08:00:00.000Z",
      advertiser_company: false
    },
    {
      id: "669796300",
      url: "https://www.subito.it/appartamenti/duplicato-669796300.htm",
      title: "Duplicato interno"
    },
    {
      id: "123456789",
      url: "https://example.com/appartamenti/annuncio-123456789.htm",
      title: "Dominio non consentito"
    },
    {
      id: "669759841",
      url: "https://www.subito.it/appartamenti/appartamento-passo-ripe-ancona-669759841.htm",
      title: "Appartamento Passo Ripe",
      price: null,
      location: "Ancona",
      surface_mq: null,
      rooms: null,
      images: [],
      published_at: null,
      advertiser_company: null
    }
  ]
};

const parsed = parse(JSON.stringify(payload));
assert.equal(parsed.ok, true, parsed.error);
assert.equal(parsed.meta.searchUrl, searchUrl);
assert.equal(parsed.meta.capturedAt, "2026-11-26T21:26:24.000Z");
assert.equal(parsed.meta.totalReported, 30);
assert.equal(parsed.meta.skipped, 2, "duplicati interni e domini esterni esclusi");
assert.equal(parsed.items.length, 2);
assert.equal(parsed.items[0].id, "669796300");
assert.equal(parsed.items[0].price, 180000);
assert.equal(parsed.items[0].surface_mq, 95);
assert.equal(parsed.items[0].images.length, 1, "solo immagini HTTPS conservate");
assert.equal(parsed.items[0].advertiser_company, false);
assert.equal(parsed.items[1].price, null);

const wrongSource = parse({ ...payload, source: "unknown" });
assert.equal(wrongSource.ok, false, "formato non riconosciuto rifiutato");
const wrongSearch = parse({ ...payload, search_url: "https://example.com/search", items: [payload.items[0]] });
assert.equal(wrongSearch.ok, false, "ricerca non Subito rifiutata");
const wrongListing = parse({ ...payload, items: [{ ...payload.items[0], id: "999999999" }] });
assert.equal(wrongListing.ok, false, "ID discordante con l'URL escluso");

const row = build(parsed.items[0], parsed.meta, "00000000-0000-4000-8000-000000000001", "batch123");
assert.equal(row.owner_id, "00000000-0000-4000-8000-000000000001");
assert.equal(row.dedup_key, "subito:669796300");
assert.equal(row.listing_key, "subito.it/appartamenti/piazza-diaz-ancona-669796300.htm");
assert.equal(row.tipo_venditore, "Privato", "Subito indica un privato per l'annuncio e il testo non lo contraddice");
assert.equal(row.stato, "da_verificare");
assert.equal(row.data_pubblicazione, null, "non inventa una data email");
assert.equal(row.dati_fonte.received_at, null, "l'importazione browser non viene spacciata per una notifica Gmail");
assert.equal(row.dati_estratti.subito.novita_non_dimostrata, true);
assert.equal(row.dati_estratti.subito.inserzionista_professionale, false);
assert.equal(row.dati_estratti.subito.pubblicato_il, "2026-11-26T08:00:00.000Z");
assert.equal(row.dati_estratti.subito.immagini.length, 1);
assert.equal(row.seller_confidence, 90);
assert.match(row.seller_evidence, /inserzionista privato/);
assert.match(row.seller_evidence, /Coerente con il filtro privati/);
assert.equal(row.dati_fonte.seller_filter_applied, true, "filtro privati letto dal link (/da-privati/)");
assert.equal(row.dati_fonte.seller_filter, "privati");
assert.match(row.dati_fonte.seller_filter_evidence, /da-privati/);
assert.equal(row.dati_estratti.subito.filtro_venditore, "privati");
assert.equal(row.dati_estratti.subito.venditore_preclassificato_da_filtro, false, "il filtro non classifica mai da solo");
assert.equal(row.dati_estratti.subito.classificazione_venditore, "dato_subito");
const noIndividualFlag = build(parsed.items[1], parsed.meta, "00000000-0000-4000-8000-000000000001", "batch123");
assert.equal(noIndividualFlag.tipo_venditore, "Da verificare", "tipo non indicato dalla scheda: non verificabile, anche con il filtro privati");
assert.equal(noIndividualFlag.seller_confidence, 0);
assert.equal(noIndividualFlag.dati_estratti.subito.classificazione_venditore, "non_verificabile");
assert.match(noIndividualFlag.seller_evidence, /non basta da solo/);
// Assenza della dicitura «Agenzia» non basta: testo con riferimenti professionali → Da verificare.
const professionalText = build({ ...parsed.items[0], description: "Per info contattare l'agenzia, provvigione 3%" }, parsed.meta, "00000000-0000-4000-8000-000000000001", "batch123");
assert.equal(professionalText.tipo_venditore, "Da verificare", "privato secondo Subito ma testo professionale: Da verificare");
assert.equal(professionalText.dati_estratti.subito.classificazione_venditore, "testo_professionale");
const negated = build({ ...parsed.items[0], description: "Vendo direttamente, no agenzie" }, parsed.meta, "00000000-0000-4000-8000-000000000001", "batch123");
assert.equal(negated.tipo_venditore, "Privato", "«no agenzie» non è un riferimento professionale");
// Filtro della ricerca controllato, non presunto.
for (const [url, status] of [
  ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/da-privati/?order=datedesc", "privati"],
  ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2", "privati"],
  ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0", "privati"],
  ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C1", "non_privati"],
  ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/da-aziende/", "non_privati"],
  ["https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/", "non_rilevato"]
]) {
  const meta = { ...parsed.meta, searchUrl: url };
  const built = build(parsed.items[0], meta, "00000000-0000-4000-8000-000000000001", "batch123");
  assert.equal(built.dati_fonte.seller_filter, status, "filtro di " + url);
  assert.equal(built.dati_fonte.seller_filter_applied, status === "privati", "filtro applicato solo se privati: " + url);
  assert.equal(built.tipo_venditore, "Privato", "il dato di Subito sull'annuncio resta valido: " + url);
  const unknown = build(parsed.items[1], meta, "00000000-0000-4000-8000-000000000001", "batch123");
  assert.equal(unknown.tipo_venditore, "Da verificare", "senza dato sull'annuncio mai privato: " + url);
}
// Stessa regola dei riferimenti professionali nell'app e nel server.
const serverSource = readFileSync("supabase/functions/nmre-gmail-scheduled/_shared/subito_full_search.ts", "utf8");
const serverHint = serverSource.match(/const PROFESSIONAL_HINT = (\/.+\/gi);/)[1];
const appHint = html.match(/const NMRE_SUBITO_PROFESSIONAL_HINT=(\/.+\/gi);/)[1];
assert.equal(appHint, serverHint, "regola dei riferimenti professionali identica nell'app e nel server");
const serverNegated = serverSource.match(/const NEGATED_HINT = (\/.+\/i);/)[1];
const appNegated = html.match(/const NMRE_SUBITO_NEGATED_HINT=(\/.+\/i);/)[1];
assert.equal(appNegated, serverNegated, "regola delle negazioni identica nell'app e nel server");
const professionalConflict = build({ ...parsed.items[0], advertiser_company: true }, parsed.meta, "00000000-0000-4000-8000-000000000001", "batch123");
assert.equal(professionalConflict.tipo_venditore, "Da verificare", "una dichiarazione esplicita di inserzionista professionale prevale sul filtro");
assert.equal(professionalConflict.seller_confidence, 0);
assert.equal(row.email_subject, "Importazione manuale dalla pagina Subito");

assert.ok(!/preclassificato come «Privato» in base al filtro|preclassifica il venditore come «Privato»/.test(html), "nessun testo dell'app promette la classificazione dal solo filtro");
console.log("Importazione Subito da browser: parsing, validazioni, filtro della ricerca controllato e classificazione prudente verificati.");
