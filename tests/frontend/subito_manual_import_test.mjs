// Test dell'importazione manuale di annunci Subito nella coda Opportunità.
// Uso: node tests/frontend/subito_manual_import_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");

function grab(name) {
  let start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  let depth = 0;
  const compactEnd = html.indexOf("){", start);
  const spacedEnd = html.indexOf(") {", start);
  const signatureEnd = spacedEnd >= 0 && (compactEnd < 0 || spacedEnd < compactEnd) ? spacedEnd : compactEnd;
  if (signatureEnd < 0) throw new Error("Firma non riconosciuta: " + name);
  const bodyStart = signatureEnd + (signatureEnd === spacedEnd ? 2 : 1);
  for (let index = bodyStart; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}

const names = ["validUrl", "isSpecificCandidateUrl", "canonicalCandidateUrl", "nmreManualSubitoCandidateRecord"];
const api = new Function(names.map(grab).join("\n") + ";return {" + names.join(",") + "};")();

let failures = 0;
function eq(actual, expected, message) {
  if (actual !== expected) {
    failures++;
    console.error("FAIL " + message + " — ottenuto " + String(actual) + ", atteso " + String(expected));
  } else console.log("ok   " + message);
}
function throws(action, expectedText, message) {
  try {
    action();
    failures++;
    console.error("FAIL " + message + " — nessun errore");
  } catch (error) {
    if (!String(error.message).includes(expectedText)) {
      failures++;
      console.error("FAIL " + message + " — " + error.message);
    } else console.log("ok   " + message);
  }
}

const url = "https://www.subito.it/ville-singole-e-a-schiera/villino-pietra-cingoli-100mq-giardino-macerata-585258623.htm";
const record = api.nmreManualSubitoCandidateRecord({
  url,
  titolo: "Villino in pietra",
  comune: "Cingoli",
  prezzo: "69000",
  tipologia_immobile: "",
  superficie_mq: "",
  suggestions: {
    titolo: "Titolo suggerito dal portale",
    comune: "Macerata",
    prezzo: 75000,
    tipologia_immobile: "Villa",
    superficie_mq: 100,
    locali: 4,
    camere: 2,
    bagni: 1
  },
  enrichmentEvidence: "Dati pubblici Schema.org"
}, "owner-123", "2026-11-27T18:00:00.000Z");

eq(record.owner_id, "owner-123", "il record è associato all'utente autenticato");
eq(record.listing_key, "subito.it/ville-singole-e-a-schiera/villino-pietra-cingoli-100mq-giardino-macerata-585258623.htm", "chiave stabile senza www e parametri");
eq(record.dedup_key, "subito-manual:" + record.listing_key, "chiave deduplicazione deterministica");
eq(record.source_email_id, record.dedup_key, "provenienza manuale riconoscibile e stabile");
eq(record.titolo, "Villino in pietra", "i dati inseriti dall'utente prevalgono sui suggerimenti");
eq(record.comune, "Cingoli", "il comune manuale prevale sul suggerimento");
eq(record.prezzo, 69000, "il prezzo manuale viene convertito in numero");
eq(record.superficie_mq, 100, "i dati mancanti vengono completati dai suggerimenti");
eq(record.locali, 4, "i locali vengono recuperati dai suggerimenti");
eq(record.tipo_venditore, "Da verificare", "il venditore non viene mai classificato privato automaticamente");
eq(record.seller_manual_override, false, "nessuna verifica manuale viene simulata");
eq(record.stato, "da_verificare", "l'annuncio entra nella coda opportunità");
eq(record.data_pubblicazione, null, "non viene inventata una data di pubblicazione");
eq(record.contatto, null, "non viene inventato alcun recapito");
eq(record.dati_fonte.source, "subito_manual", "la provenienza manuale è registrata");
eq(record.dati_fonte.enrichment_evidence, "Dati pubblici Schema.org", "la provenienza dell'arricchimento è conservata");

throws(() => api.nmreManualSubitoCandidateRecord({
  url, titolo: "", comune: "", suggestions: {}
}, "owner-123"), "titolo e comune", "titolo e comune sono obbligatori se l'analisi non li trova");
throws(() => api.nmreManualSubitoCandidateRecord({
  url: "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/", titolo: "Ricerca", comune: "Ancona"
}, "owner-123"), "singolo annuncio", "una pagina risultati non viene accettata come annuncio");
throws(() => api.nmreManualSubitoCandidateRecord({
  url: "https://example.com/annuncio-585258623.htm", titolo: "Casa", comune: "Ancona"
}, "owner-123"), "Subito", "sono accettati soltanto domini Subito");
throws(() => api.nmreManualSubitoCandidateRecord({
  url: url.replace("https://", "http://"), titolo: "Casa", comune: "Ancona"
}, "owner-123"), "HTTPS", "i link non sicuri vengono rifiutati");
throws(() => api.nmreManualSubitoCandidateRecord({
  url, titolo: "Casa", comune: "Ancona", prezzo: "-1"
}, "owner-123"), "Prezzo non valido", "un prezzo negativo viene rifiutato");
throws(() => api.nmreManualSubitoCandidateRecord({
  url, titolo: "Casa", comune: "Ancona", superficie_mq: "100.5"
}, "owner-123"), "Superficie non valido", "la superficie deve essere un numero intero positivo");

if (failures) {
  console.error("\n" + failures + " test falliti.");
  process.exitCode = 1;
} else {
  console.log("\nTutti i test dell'importazione manuale Subito sono superati.");
}
