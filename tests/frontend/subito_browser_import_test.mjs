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
assert.equal(row.tipo_venditore, "Da verificare");
assert.equal(row.stato, "da_verificare");
assert.equal(row.data_pubblicazione, null, "non inventa una data email");
assert.equal(row.dati_fonte.received_at, null, "l'importazione browser non viene spacciata per una notifica Gmail");
assert.equal(row.dati_estratti.subito.novita_non_dimostrata, true);
assert.equal(row.dati_estratti.subito.inserzionista_professionale, false);
assert.equal(row.dati_estratti.subito.pubblicato_il, "2026-11-26T08:00:00.000Z");
assert.equal(row.dati_estratti.subito.immagini.length, 1);
assert.equal(row.seller_confidence, 0);
assert.equal(row.email_subject, "Importazione manuale dalla pagina Subito");

console.log("Importazione Subito da browser: parsing, validazioni, deduplica interna e scheda «Da verificare» verificati.");
