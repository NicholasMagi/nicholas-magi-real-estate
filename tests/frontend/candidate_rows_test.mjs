// Nuove opportunità: una riga compatta, generata da un unico componente per ogni portale, che
// conserva tutte le azioni e i gestori esistenti. Controlli sul codice di index.html.
// Uso: node tests/frontend/candidate_rows_test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const start = html.indexOf("function renderCandidates(){");
const render = html.slice(start, html.indexOf("async function loadCandidates(options={}){", start));

assert.equal((render.match(/'<article id="candidate-'/g) || []).length, 1, "un solo modello di riga per tutte le opportunità");
assert.match(render, /class="candidate candidate-row candidate-source-'\+sourceTheme\+'"/, "stessa riga per ogni portale (il portale cambia solo colore ed etichetta)");
assert.doesNotMatch(render, /if\s*\(\s*(?:sourceTheme|c\.portale)\s*===/, "nessun ramo di markup specifico per portale");
for (const col of ["comune", "prezzo", "superficie", "data"]) assert.match(render, new RegExp('rowCell\\("' + col + '"'), "colonna " + col);
for (const col of ["portale", "venditore"]) assert.match(render, new RegExp('data-col="' + col + '"'), "colonna " + col);
assert.match(render, /class="candidate-row-head"/, "intestazione delle colonne");
// Azioni ed elementi usati dai gestori esistenti: invariati.
for (const attr of ["data-open-listing", "data-open-candidate-details", "data-confirm", "data-discard", "data-candidate-details", "data-save-seller", "data-enrich",
  "data-enrichment-result", 'data-field="venditore"', 'data-field="titolo"', "data-url-originale", "data-portal"]) {
  assert.ok(render.includes(attr), "elemento conservato: " + attr);
}
assert.match(render, /target="_blank" rel="noopener noreferrer" data-open-listing=/, "annuncio originale in una nuova scheda");
assert.match(render, /\+nmreSubitoRecoveryHtml\(c\)/, "dettagli della ricerca salvata Subito nel pannello");
assert.match(render, /data-subito-import-link="'\+safe\(rowSearchUrl\)\+'"/, "«Importa» sulla riga della ricerca salvata");
assert.match(render, /details\.open=!details\.open;/, "«Dettagli» apre e chiude il pannello");
assert.match(render, /\.candidate-row \.candidate-detail-panel:not\(\[open\]\)\{display:none\}|candidate-row-summary/, "pannello chiuso di default");
// Scarto: invariato (conferma con motivo, storico, nessuna cancellazione).
const discard = html.slice(html.indexOf("async function discardCandidate(id,button){"), html.indexOf("async function discardCandidate(id,button){") + 2600);
assert.match(discard, /const reason=prompt\(question\+"\\nMotivo dello scarto:","Non pertinente"\);\s*if\(reason===null\)return;/, "scarto con conferma e motivo");
assert.match(discard, /azione:"scartato"/, "scarto registrato nello storico");
assert.doesNotMatch(discard, /\.delete\(/, "nessuna cancellazione");
// Filtri e ricerca: invariati.
for (const id of ["candidateSearch", "candidateTownFilter", "candidateTypeFilter", "candidatePortalFilter", "candidateSellerFilter", "candidateQualityFilter", "candidatePriceMin", "candidateSurfaceMax", "candidateFromFilter"]) {
  assert.ok(render.includes('"' + id + '"'), "filtro applicato: " + id);
}
assert.match(html, /\.candidate-row-head\{display:none\}/, "su schermo stretto la riga diventa una scheda breve, senza intestazione");
assert.match(html, /#candidateList\{padding-bottom:calc\(84px \+ env\(safe-area-inset-bottom,0px\)\)\}/, "su mobile resta spazio sotto l’ultima riga per non coprirla con il launcher fisso");
console.log("Nuove opportunità: riga compatta unica, azioni, filtri e scarto verificati.");
