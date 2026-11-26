// Importazione della rubrica del telefono (vCard, Contact Picker), piano senza scritture,
// possibili duplicati e scrittura protetta. Funzioni estratte da index.html.
// Uso: node tests/frontend/contacts_import_test.mjs
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
const names = ["nmreIdentityKey", "nmrePhoneKeys", "nmrePhoneKey", "nmreExtractListingPhones", "nmreMatchContactForListing", "nmreDecodeQuotedPrintable",
  "nmreVcardUnescape", "nmreParseVcard", "nmreContactFromPicker", "nmreNotesExtraValues", "nmreContactPhoneKeysAll", "nmreContactEmailsAll",
  "nmreImportedNotes", "nmrePlanContactImport", "nmreFindContactDuplicates", "nmreContactImportDateLabel", "nmreApplyContactImport"];
const nodes = {};
const el = id => nodes[id] ??= { textContent: "", innerHTML: "", hidden: true, disabled: false };
const api = new Function("env",
  "let currentUser=null,supabase=null,nmreCrmContacts=[],nmreContactImportSource=null;const $=id=>env.el(id);" +
  "async function loadCrmWorkspace(){nmreCrmContacts=env.reload();}" +
  constLine("NMRE_EXTRA_PHONES_LABEL") + constLine("NMRE_EXTRA_EMAILS_LABEL") + names.map(grab).join("\n") +
  `;return {nmreParseVcard,nmreContactFromPicker,nmrePlanContactImport,nmreFindContactDuplicates,nmreContactPhoneKeysAll,nmreContactEmailsAll,
    match(item,contacts){nmreCrmContacts=contacts;return nmreMatchContactForListing(item);},
    async apply(input){currentUser=input.user;supabase=input.supabase;nmreContactImportSource=input.source;await nmreApplyContactImport();}};`
)({ el, reload: () => env.contacts });
const env = { contacts: [] };

let failures = 0;
function eq(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error("FAIL " + message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected));
  } else console.log("ok   " + message);
}

// ---------- Lettura vCard ----------
const IPHONE = [
  "BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Apple Inc.//iPhone OS 17.0//EN", "N:Rossi;Mario;;;", "FN:Mario Rossi",
  "item1.TEL;type=CELL;type=VOICE;type=pref:+39 333 123 4567", "TEL;type=HOME;type=VOICE:071 7123456",
  "item2.EMAIL;type=INTERNET;type=pref:Mario.Rossi@Example.com", "ADR;type=HOME:;;Via Roma 1;Osimo;AN;60027;Italia",
  "NOTE:Proprietario trilocale\\, via Roma", "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQ", " ABCDEFGHIJ", "END:VCARD"
].join("\r\n");
const ANDROID = [
  "BEGIN:VCARD", "VERSION:2.1", "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Verdi;Niccol=C3=B2;;;",
  "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Niccol=C3=B2 Verdi", "TEL;CELL:+393401112233", "TEL;CELL:0039 340 111 2233",
  "TEL;WORK:(071) 555-0199", "NOTE;ENCODING=QUOTED-PRINTABLE:Riga lunga =", "continua qui", "END:VCARD",
  "BEGIN:VCARD", "VERSION:2.1", "FN:Niccolò Verdi", "TEL;HOME:+39 071 222 3344", "END:VCARD",
  "BEGIN:VCARD", "VERSION:2.1", "TEL;CELL:+39 320 000 0001", "END:VCARD",
  "BEGIN:VCARD", "VERSION:2.1", "END:VCARD"
].join("\n");
const V4 = [
  "BEGIN:VCARD", "VERSION:4.0", "FN:Lucia", "  Bianchi", "TEL;VALUE=uri;TYPE=\"cell,voice\":tel:+39-347-765-4321",
  "TEL;TYPE=work:(071) 555 0199", "EMAIL:lucia@example.com", "END:VCARD"
].join("\n");

const iphone = api.nmreParseVcard(IPHONE);
eq(iphone.length, 1, "iPhone: una scheda");
eq(iphone[0].full_name, "Mario Rossi", "iPhone: nome");
eq(iphone[0].phones, [{ number: "+39 333 123 4567", label: "cellulare" }, { number: "071 7123456", label: "casa" }], "iPhone: tutti i numeri, cellulare per primo");
eq([iphone[0].emails, iphone[0].address, iphone[0].municipality, iphone[0].note], [["mario.rossi@example.com"], "Via Roma 1", "Osimo", "Proprietario trilocale, via Roma"],
  "iPhone: email, indirizzo, comune, nota (foto ignorata)");
const android = api.nmreParseVcard(ANDROID);
eq(android.length, 3, "Android: schede vuote ignorate");
eq(android[0].full_name, "Niccolò Verdi", "Android: quoted-printable UTF-8 con accenti");
eq(android[0].phones.map(p => p.number), ["+393401112233", "(071) 555-0199"], "Android: stesso numero in formati diversi letto una volta sola");
eq(android[0].note, "Riga lunga continua qui", "Android: ritorno a capo «soft» del quoted-printable");
eq([android[2].full_name, android[2].phones.length], ["", 1], "scheda senza nome ma con numero conservata");
const v4 = api.nmreParseVcard(V4);
eq([v4[0].full_name, v4[0].phones.map(p => p.number)], ["Lucia Bianchi", ["+39-347-765-4321", "(071) 555 0199"]], "vCard 4.0: riga ripiegata e numero tel:");
eq(api.nmreContactFromPicker({ name: ["Paolo Neri"], tel: ["+39 335 1", "+39 335 999 8877", "0039 335 9998877"], email: ["P@x.it"] }),
  { full_name: "Paolo Neri", phones: [{ number: "+39 335 999 8877", label: "altro" }], emails: ["p@x.it"], org: "", title: "", address: "", municipality: "", note: "" },
  "Contact Picker: numeri non validi o ripetuti scartati");

// ---------- Piano di importazione ----------
const existing = [
  { owner_id: "u1", id: "c1", full_name: "Mario Rossi", phone: "3331234567", email: null, notes: "Cliente storico", updated_at: "2026-11-01T10:00:00Z" },
  { owner_id: "u1", id: "c2", full_name: "Studio Verdi", phone: "071 555 0199", email: null, notes: null, updated_at: "2026-11-01T10:00:00Z" },
  { owner_id: "u1", id: "c3", full_name: "Anna Verdi", phone: "+39 071 5550199", email: null, notes: null, updated_at: "2026-11-01T10:00:00Z" },
  { owner_id: "u1", id: "c4", full_name: "Giulia Neri", phone: "347 000 1111", email: "giulia@example.com", notes: "Altri numeri: 347 765 4321 (casa)", updated_at: "2026-11-01T10:00:00Z" }
];
const plan = api.nmrePlanContactImport([...iphone, ...android, ...v4], existing, "26/11/26");
const byName = name => plan.items.find(item => item.contact.full_name === name);
const mario = byName("Mario Rossi");
eq([mario.category, mario.matches.map(m => m.id)], ["aggiorna", ["c1"]], "Mario: stesso numero senza +39 → contatto esistente");
eq(mario.update.email, "mario.rossi@example.com", "Mario: email vuota riempita");
eq(/Altri numeri: 071 7123456 \(casa\)/.test(mario.update.notes) && mario.update.notes.startsWith("Cliente storico"), true, "Mario: nota esistente conservata, nuovo numero aggiunto");
eq("phone" in mario.update, false, "Mario: numero principale esistente non sostituito");
const niccolo = plan.items.filter(item => item.contact.full_name === "Niccolò Verdi");
eq(niccolo[0].category, "da_verificare", "Niccolò: il numero dell'ufficio corrisponde a due contatti → nessuna modifica");
eq(niccolo[1].category, "nuovo", "seconda scheda Niccolò senza recapiti in comune: non unita (persone diverse possibili)");
const lucia = byName("Lucia Bianchi");
eq(lucia.category, "da_verificare", "Lucia: numero in comune con Giulia (note) e con lo studio → da verificare");
const nameless = plan.items.find(item => item.contact.phones[0]?.number === "+39 320 000 0001");
eq([nameless.category, nameless.insert.full_name], ["nuovo", "+39 320 000 0001"], "scheda senza nome: creata con il numero come nome");
eq(plan.items.some(item => item.category === "da_verificare" && (item.insert || item.update)), false, "nessuna scrittura prevista per i casi da verificare");
const fileTwin = api.nmrePlanContactImport(api.nmreParseVcard(IPHONE + "\n" + IPHONE.replace("071 7123456", "071 7999999")), [], "26/11/26");
eq(fileTwin.items.map(item => item.category), ["nuovo", "doppione_nel_file"], "stessa persona due volte nel file: una sola scheda");
eq(/071 7999999/.test(fileTwin.items[0].insert.notes) && /071 7123456/.test(fileTwin.items[0].insert.notes), true, "tutti i numeri delle due schede conservati");
const fresh = api.nmrePlanContactImport(api.nmreParseVcard(ANDROID.split("BEGIN:VCARD").slice(0, 2).join("BEGIN:VCARD")), [], "26/11/26");
eq(fresh.items[0].insert, { full_name: "Niccolò Verdi", contact_type: "altro", phone: "+393401112233", email: null, municipality: null, address: null, status: "nuovo",
  notes: "Altri numeri: (071) 555-0199 (lavoro)\nRiga lunga continua qui\nImportato dalla rubrica del telefono il 26/11/26" }, "nuovo contatto: tutti i dati, numeri secondari nelle note");
const again = api.nmrePlanContactImport(iphone, [{ ...existing[0], email: "mario.rossi@example.com", notes: "Altri numeri: 071 7123456 (casa)" }], "27/11/26");
eq(again.items[0].category, "gia_presente", "importazione ripetuta: nessuna modifica se non c'è nulla di nuovo");

// ---------- Possibili duplicati ----------
const groups = api.nmreFindContactDuplicates([...existing, { id: "c5", full_name: "Giulia Neri", phone: "0039 347 7654321", email: null, notes: null }]);
const verdi = groups.find(g => g.contacts.some(c => c.id === "c2"));
eq(verdi.contacts.map(c => c.id).sort(), ["c2", "c3"], "stesso numero scritto in formati diversi");
eq([verdi.sameName, verdi.shared], [false, ["telefono 0715550199"]], "persone diverse segnalate, nessuna unione");
const neri = groups.find(g => g.contacts.some(c => c.id === "c5"));
eq([neri.contacts.map(c => c.id).sort(), neri.sameName], [["c4", "c5"], true], "numero secondario nelle note confrontato con il principale");
eq(groups.some(g => g.contacts.some(c => c.id === "c1")), false, "contatto senza recapiti in comune non segnalato");

// ---------- Collegamento agli annunci con i numeri secondari ----------
eq(api.match({ id: "a1", contatto: "Giulia · 347 765 4321" }, [existing[3]])?.id, "c4", "annuncio collegato tramite un numero secondario");

// ---------- Scrittura protetta ----------
function fakeSupabase(db, log) {
  return {
    from(table) {
      const q = { op: "select", filters: [], payload: null };
      const b = {
        insert(payload) { q.op = "insert"; q.payload = payload; return b; },
        update(payload) { q.op = "update"; q.payload = payload; return b; },
        eq(c, v) { q.filters.push(r => String(r[c] ?? "") === String(v ?? "")); return b; },
        select() { return b; },
        then(resolve) {
          log.push(q.op + ":" + table);
          if (q.op === "insert") { db.push({ id: "n" + db.length, ...q.payload }); resolve({ data: null, error: null }); return; }
          const rows = db.filter(r => q.filters.every(f => f(r)));
          rows.forEach(r => Object.assign(r, q.payload));
          resolve({ data: rows.map(r => ({ id: r.id })), error: null });
        }
      };
      return b;
    }
  };
}
const db = structuredClone(existing);
env.contacts = db;
const log = [];
await api.apply({ user: { id: "u1" }, supabase: fakeSupabase(db, log), source: [...iphone, ...v4, api.nmreParseVcard(ANDROID)[2]] });
eq(log.filter(op => op === "insert:nmre_contacts").length, 1, "una sola scheda nuova creata");
eq(db.find(c => c.id === "c1").email, "mario.rossi@example.com", "contatto esistente aggiornato in modo additivo");
eq(db.find(c => c.id === "c4").notes, "Altri numeri: 347 765 4321 (casa)", "contatto da verificare non modificato");
eq(/creati/.test(nodes.nmreContactImportMsg.textContent), true, "messaggio con l'esito");
const stale = structuredClone(existing);
env.contacts = stale.map(c => c.id === "c1" ? { ...c, updated_at: "2026-11-02T00:00:00Z" } : c);
const staleLog = [];
await api.apply({ user: { id: "u1" }, supabase: fakeSupabase(stale, staleLog), source: iphone });
eq(stale.find(c => c.id === "c1").email, null, "contatto modificato nel frattempo: nessuna sovrascrittura");
eq(/modificati nel frattempo/.test(nodes.nmreContactImportMsg.textContent), true, "conflitto segnalato");

if (failures) { console.error(failures + " test non superati"); process.exit(1); }
console.log("Tutti i test di importazione della rubrica superati.");
