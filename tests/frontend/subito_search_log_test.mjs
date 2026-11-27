// Pannello «Ricerche Subito» del monitor: testo di ogni sincronizzazione dal registro
// nmre_subito_ricerche_sync. Funzioni estratte da index.html. Uso: node tests/frontend/subito_search_log_test.mjs
import { readFileSync } from "node:fs";
const html = readFileSync("index.html", "utf8");
function grab(name) {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  let depth = 0;
  for (let index = html.indexOf("){", start) + 1; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}
const outcomes = html.match(/const NMRE_SUBITO_LOG_OUTCOME=\{[^;]+\};/)[0];
const line = new Function(outcomes + grab("nmreSubitoLogLine") + ";return nmreSubitoLogLine;")();
let failures = 0;
const check = (ok, message, detail) => { if (ok) console.log("ok   " + message); else { failures++; console.error("FAIL " + message + " — " + detail); } };
const base = { eseguita_il: "2026-11-26T08:30:00Z", ricerca_nome: "Appartamenti a Ancona e provincia", annunci_trovati: 263, pagine_lette: 9, pagine_dichiarate: 9,
  nuove_opportunita: 12, gia_in_opportunita: 240, gia_in_archivio: 11, da_verificare: 5, duplicati_da_unificare: 0 };
const ok = line({ ...base, esito: "completa", motivo: "ricerca_completa" });
for (const part of ["Appartamenti a Ancona e provincia", "completa", "263 annunci trovati (9/9 pagine)", "12 nuove opportunità", "240 già in Opportunità", "11 già in Archivio", "5 da verificare"]) {
  check(ok.includes(part), "riga completa contiene «" + part + "»", ok);
}
check(!ok.includes("Motivo"), "nessun motivo per una ricerca completa", ok);
const blocked = line({ ...base, esito: "errore", motivo: "pagina_bloccata", motivo_testo: "Pagina dei risultati protetta (verifica anti-robot): non aggirata", annunci_trovati: 0, pagine_lette: 0 });
check(blocked.includes("in attesa di recupero") && blocked.includes("non aggirata"), "errore: in attesa di recupero con il motivo", blocked);
const absorbed = line({ ...base, esito: "assorbita", motivo: "assorbita" });
check(absorbed.includes("aggiornata da un'email più recente") && !absorbed.includes("annunci trovati"), "email assorbita: nessun conteggio", absorbed);
check(line({ ...base, esito: "completa", duplicati_da_unificare: 2 }).includes("2 duplicati da unificare"), "duplicati da unificare indicati", "");
check(/if\(error\|\|!Array\.isArray\(data\)\|\|!data\.length\)\{box\.hidden=true/.test(html), "tabella assente (migrazione non applicata): pannello nascosto", "");
check(/\^https:\\\/\\\/www\\\.subito\\\.it\\\//.test(html), "link alla ricerca solo verso www.subito.it", "");
if (failures) { console.error(failures + " controlli non superati"); process.exit(1); }
console.log("Pannello delle ricerche Subito verificato.");
