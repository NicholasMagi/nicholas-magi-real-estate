// Associazioni automatiche Rubrica/Archivio/CRM: confronto telefoni e protezione dei link manuali.
// Uso: node tests/frontend/contact_autolink_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");

function grab(name) {
  let start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  if (html.slice(start - 6, start) === "async ") start -= 6;
  let depth = 0;
  for (let index = html.indexOf("){", start) + 1; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}

const constLine = name => { const m = html.match(new RegExp("const " + name + "=[^;]+;")); if (!m) throw new Error("Costante non trovata: " + name); return m[0]; };
const names = [
  "nmreIdentityKey",
  "nmreNotesExtraValues",
  "nmreContactPhoneKeysAll",
  "nmrePhoneKeys",
  "nmrePhoneKey",
  "nmreExtractListingPhones",
  "nmreMatchContactForListing",
  "nmreSyncArchiveContactLinks"
];
const api = new Function(
  "let currentUser=null,supabase=null,listingCache=[],nmreCrmContacts=[],nmreCrmProperties=[],nmreCrmPropertyContacts=[];" +
  constLine("NMRE_EXTRA_PHONES_LABEL") +
  names.map(grab).join("\n") +
  `
  return {
    nmrePhoneKeys,nmrePhoneKey,nmreExtractListingPhones,
    match(item, contacts){nmreCrmContacts=contacts;return nmreMatchContactForListing(item);},
    async sync(input){
      currentUser=input.currentUser;supabase=input.supabase;listingCache=input.listingCache;
      nmreCrmContacts=input.contacts;nmreCrmProperties=input.properties;
      nmreCrmPropertyContacts=input.propertyContacts||[];
      await nmreSyncArchiveContactLinks();
      return {listingCache,nmreCrmProperties,nmreCrmPropertyContacts};
    }
  };
  `
)();

let failures = 0;
function eq(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error("FAIL " + message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected));
  } else console.log("ok   " + message);
}

const contact = {
  id: "c1", full_name: "Mario Rossi", contact_type: "proprietario",
  phone: "+39 333 123 4567", email: null, municipality: "Osimo", address: null
};

eq(api.nmrePhoneKey("+39 333 123 4567"), "3331234567", "numero italiano con prefisso internazionale normalizzato");
eq(api.nmrePhoneKey("0039 (333) 123-4567"), "3331234567", "prefisso internazionale 0039 normalizzato");
eq(api.nmrePhoneKey("333.123.4567"), "3331234567", "spazi, punti e separatori rimossi");
eq(api.nmrePhoneKey("12345"), "", "numeri troppo corti ignorati");
eq(api.nmrePhoneKeys("+39 333 123 4567").includes("3331234567"), true, "la chiave internazionale coincide con il numero nazionale");

const listing = {
  id: "a1", comune: "Osimo", titolo: "Appartamento",
  contatto: "Mario Rossi · 333 123 4567"
};
eq(api.nmreExtractListingPhones(listing), ["333 123 4567"], "telefono estratto dal campo contatto dell'annuncio");
eq(api.match(listing, [contact])?.id, "c1", "numero senza +39 dell'annuncio associato al contatto con +39 in Rubrica");
eq(api.match({...listing, contatto: null, seller_identity: "Proprietario: 0039 333 1234567"}, [contact])?.id,
  "c1", "numero nel campo seller_identity riconosciuto");
eq(api.match({...listing, contatto: null, seller_identity: null, prezzo: "3331234567"}, [contact]),
  null, "un numero nel prezzo o in un campo non identificativo non genera associazioni");
eq(api.match(listing, [contact, {...contact, id: "c2", full_name: "Luigi Bianchi"}]),
  null, "un numero condiviso da più contatti non viene assegnato automaticamente");

// Simula le tre scritture protette: archivio, tabella relazioni, referente principale CRM.
function fakeSupabase(db) {
  return {
    from(table) {
      const query = {operation: "select", filters: [], payload: null, single: false};
      const builder = {
        update(payload) { query.operation = "update"; query.payload = payload; return builder; },
        upsert(payload) { query.operation = "upsert"; query.payload = payload; return builder; },
        eq(column, value) { query.filters.push(row => String(row[column] ?? "") === String(value ?? "")); return builder; },
        is(column, value) { query.filters.push(row => (row[column] ?? null) === value); return builder; },
        select() { return builder; },
        maybeSingle() { query.single = true; return builder; },
        then(resolve) {
          const rows = db[table] || (db[table] = []);
          if (query.operation === "upsert") {
            const row = query.payload;
            const existing = rows.find(item =>
              String(item.owner_id) === String(row.owner_id) &&
              String(item.property_id) === String(row.property_id) &&
              String(item.contact_id) === String(row.contact_id)
            );
            if (!existing) rows.push(structuredClone(row));
            resolve({data: structuredClone(existing || row), error: null});
            return;
          }
          if (query.operation === "update") {
            const row = rows.find(item => query.filters.every(filter => filter(item)));
            if (row) Object.assign(row, structuredClone(query.payload));
            resolve({data: row ? structuredClone(row) : null, error: null});
            return;
          }
          resolve({data: null, error: null});
        }
      };
      return builder;
    }
  };
}

const db = {
  annunci: [{id: "a1", owner_id: "u1", contact_id: null, deleted_at: null}],
  nmre_properties: [{id: "p1", owner_id: "u1", source_listing_id: "a1", contact_id: null}],
  nmre_property_contacts: []
};
const cache = [{...listing, owner_id: "u1", contact_id: null, deleted_at: null}];
const properties = structuredClone(db.nmre_properties);
const linked = await api.sync({
  currentUser: {id: "u1"}, supabase: fakeSupabase(db), listingCache: cache,
  contacts: [contact], properties, propertyContacts: []
});
eq(db.annunci[0].contact_id, "c1", "annuncio in Archivio collegato automaticamente al contatto");
eq(db.nmre_properties[0].contact_id, "c1", "scheda immobile CRM collegata come referente principale");
eq(db.nmre_property_contacts.length, 1, "relazione contatto/immobile creata una sola volta");
eq(db.nmre_property_contacts[0].relation_role, "proprietario", "ruolo predefinito coerente con un annuncio in vendita");
eq(linked.listingCache[0].contact_id, "c1", "cache aggiornata dopo la scrittura confermata");

// Un referente assegnato manualmente non viene sostituito.
const protectedDb = {
  annunci: [{id: "a1", owner_id: "u1", contact_id: "manual", deleted_at: null}],
  nmre_properties: [{id: "p1", owner_id: "u1", source_listing_id: "a1", contact_id: "manual"}],
  nmre_property_contacts: [{owner_id: "u1", property_id: "p1", contact_id: "manual", relation_role: "proprietario"}]
};
await api.sync({
  currentUser: {id: "u1"}, supabase: fakeSupabase(protectedDb),
  listingCache: [{...listing, owner_id: "u1", contact_id: "manual", deleted_at: null}],
  contacts: [contact], properties: structuredClone(protectedDb.nmre_properties),
  propertyContacts: structuredClone(protectedDb.nmre_property_contacts)
});
eq(protectedDb.annunci[0].contact_id, "manual", "collegamento manuale dell'archivio preservato");
eq(protectedDb.nmre_properties[0].contact_id, "manual", "referente CRM manuale preservato");
eq(protectedDb.nmre_property_contacts.length, 1, "nessuna seconda relazione aggiunta su un referente diverso");

if (failures) {
  console.error(failures + " test non superati");
  process.exit(1);
}
console.log("Tutti i test di associazione automatica contatti/immobili superati.");
