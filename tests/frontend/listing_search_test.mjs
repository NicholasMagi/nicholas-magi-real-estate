// Ricerca condivisa per Opportunità e Archivio: testo, ID/link, indirizzo e telefoni normalizzati.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");

function grab(name) {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  let depth = 0;
  const bodyStart = html.indexOf("){", start) + 1;
  for (let index = bodyStart; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}

const names = [
  "nmrePhoneKeys",
  "nmreListingSearchNormalize",
  "nmreListingSearchPhoneKeysFromText",
  "nmreListingSearchContactPhoneKeys",
  "nmreUnifiedListingSearchMatch"
];
const contacts = [{
  id: "c1",
  full_name: "Mario Rossi",
  phone: "+39 333 123 4567",
  email: "mario.rossi@example.it",
  municipality: "Osimo",
  address: "Via Roma 10",
  notes: "Cliente storico\nAltri numeri: 071 234 5678 (ufficio); 347 456 7890 (cellulare)"
}];

const api = new Function(
  "nmreCrmContacts",
  names.map(grab).join("\n") + "\nreturn {nmreUnifiedListingSearchMatch};"
)(contacts);
const match = api.nmreUnifiedListingSearchMatch;

const archive = {
  id: "subito-991122",
  contact_id: "c1",
  titolo: "Trilocale luminoso",
  comune: "Osimo",
  indirizzo: "Via Roma 10",
  portale: "Subito.it",
  url: "https://www.subito.it/annunci/991122"
};

assert.equal(match(archive, "trilocale luminoso"), true, "titolo");
assert.equal(match(archive, "via roma 10"), true, "indirizzo completo");
assert.equal(match(archive, "roma osimo"), true, "ricerca per più parole");
assert.equal(match(archive, "Mario Rossi"), true, "nome del contatto collegato");
assert.equal(match(archive, "mario.rossi@example.it"), true, "email del contatto collegato");
assert.equal(match(archive, "991122"), true, "ID annuncio");
assert.equal(match(archive, "subito.it/annunci/991122"), true, "link originale");
assert.equal(match(archive, "+39 333 123 4567"), true, "telefono principale con prefisso");
assert.equal(match(archive, "3331234567"), true, "telefono principale senza formattazione");
assert.equal(match(archive, "071 2345678"), true, "telefono secondario nelle note");
assert.equal(match(archive, "+39 347 456 7890"), true, "secondo telefono secondario");
assert.equal(match(archive, "333 000 0000"), false, "telefono non corrispondente");
assert.equal(match(archive, "contatto inesistente"), false, "testo non corrispondente");

const candidate = {
  id: "candidate-22",
  email_subject: "Appartamenti ad Ancona e provincia",
  notification_sender: "Subito",
  titolo: "Appartamento vicino al centro",
  comune: "Ancona",
  seller_identity: "Mario Rossi",
  contatto: "Telefono venditore: 0039 333 1234567",
  url_originale: "https://www.subito.it/annunci/445566"
};
assert.equal(match(candidate, "mario rossi"), true, "nome del venditore nell'opportunità");
assert.equal(match(candidate, "333 123 4567"), true, "telefono nell'opportunità");
assert.equal(match(candidate, "445566"), true, "ID/link dell'opportunità");
assert.equal(match(candidate, "appartamenti ancona"), true, "oggetto email e comune");
assert.equal(match(candidate, "ufficio 071 234 5678"), false, "un recapito di un contatto non collegato non deve contaminare la ricerca");
assert.equal(match(archive, "   "), true, "ricerca vuota non filtra risultati");

assert.ok(
  html.includes('return (!query||nmreUnifiedListingSearchMatch(item,query))'),
  "Archivio deve usare il motore di ricerca condiviso"
);
assert.ok(
  html.includes('return (!term||nmreUnifiedListingSearchMatch(item,term))'),
  "Opportunità deve usare il motore di ricerca condiviso"
);

console.log("Ricerca condivisa: tutti i 21 controlli superati.");
