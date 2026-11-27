// Ricerca di Opportunità e Archivio: testo su tutti i campi dichiarati e numeri di telefono
// normalizzati (annuncio e contatto collegato). Funzioni estratte da index.html.
// Uso: node tests/frontend/search_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");
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
const optional = ["nmreNotesExtraValues", "nmreContactPhoneKeysAll"].filter(name => html.includes("function " + name + "("));
const constLine = name => (html.match(new RegExp("const " + name + "=[^;]+;")) || [""])[0];
const api = new Function("contacts",
  "let nmreCrmContacts=contacts;" + constLine("NMRE_EXTRA_PHONES_LABEL") + constLine("NMRE_EXTRA_EMAILS_LABEL") +
  ["nmrePhoneKeys", "nmrePhoneKey", "nmreExtractListingPhones", ...optional, "nmreLinkedContact", "nmreListingPhoneSearchKeys", "nmreSearchMatches"].map(grab).join("\n") +
  ";return {nmreLinkedContact,nmreListingPhoneSearchKeys,nmreSearchMatches};"
)([{ id: "c1", full_name: "Mario Rossi", phone: "+39 333 123 4567", notes: "Altri numeri: 071 7123456 (casa)" }]);

let failures = 0;
function eq(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error("FAIL " + message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected));
  } else console.log("ok   " + message);
}
const listing = { id: "a1", titolo: "Trilocale", comune: "Osimo", indirizzo: "Via Roma 12", contatto: "Proprietario · 340 111 2233", contact_id: "c1" };
const archiveTexts = item => [item.titolo, item.comune, item.indirizzo, item.portale, item.contatto, item.tipologia_immobile, item.url, api.nmreLinkedContact(item)?.full_name];
const find = (item, term) => api.nmreSearchMatches(archiveTexts(item), term.trim().toLocaleLowerCase("it"), api.nmreListingPhoneSearchKeys(item));

eq(find(listing, "via roma"), true, "la via (indirizzo) è cercata, come dichiarato nel campo");
eq(find(listing, "mario"), true, "il nome del contatto collegato della Rubrica è cercato");
eq(find(listing, "3401112233"), true, "numero dell'annuncio scritto senza spazi");
eq(find(listing, "+39 340 111 2233"), true, "numero dell'annuncio con +39");
eq(find(listing, "333-123-4567"), true, "numero principale del contatto collegato, con trattini");
eq(find(listing, "0717123456"), optional.length === 2, "numero secondario del contatto collegato (con la Rubrica estesa)");
eq(find(listing, "12345"), false, "meno di 6 cifre: nessun confronto telefonico");
eq(find(listing, "ancona"), false, "nessun risultato inventato");
eq(find({ ...listing, contact_id: null }, "mario"), false, "senza collegamento il contatto non viene cercato");
const subito = { titolo: "Bilocale", url: "https://www.subito.it/appartamenti/bilocale-ancona-669796300.htm", dati_estratti: { subito: { id: "669796300" } } };
eq(api.nmreSearchMatches([subito.titolo, subito.url, subito.dati_estratti.subito.id], "669796300", api.nmreListingPhoneSearchKeys(subito)), true, "un annuncio Subito si trova con il suo ID");

eq(/const texts=\[item\.email_subject,item\.notification_sender,item\.titolo,item\.comune,item\.indirizzo/.test(html), true, "Opportunità: la ricerca usa i campi estesi");
eq(/return \(!term\|\|nmreSearchMatches\(texts,term,nmreListingPhoneSearchKeys\(item\)\)\)/.test(html), true, "Opportunità: ricerca condivisa");
eq(/return \(!query\|\|nmreSearchMatches\(texts,query,nmreListingPhoneSearchKeys\(item\)\)\)/.test(html), true, "Archivio: ricerca condivisa");

if (failures) { console.error(failures + " test non superati"); process.exit(1); }
console.log("Tutti i test della ricerca superati.");
