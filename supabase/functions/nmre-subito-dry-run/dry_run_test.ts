// Prova senza scritture sull'email e sulla pagina REALI del 26/11/2026 (fixture ripulite di
// nmre-gmail-scheduled). Database simulato in memoria, avvolto da readOnlyDb: ogni
// scrittura sarebbe un errore e il contatore delle scritture del database deve restare 0.
// deno-lint-ignore-file no-explicit-any
import { fakeSupabase } from "../nmre-gmail-scheduled/fake_supabase.ts";
import { readOnlyDb, readOnlyGmail } from "./readonly.ts";
import { reportText, selectEmail, subitoDryRun, validateRequest } from "./dry_run.ts";

function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected));
  }
}
const fixture = (name: string) => Deno.readTextFileSync(new URL("../nmre-gmail-scheduled/fixtures/" + name, import.meta.url));
const REAL_HTML = fixture("subito_real_email.html");
const REAL_TEXT = fixture("subito_real_email.txt");
const REAL_PAGE = fixture("subito_real_results_page.html");
const CAPTCHA_PAGE = fixture("subito_results_page_captcha.html");
const OWNER = "00000000-0000-4000-8000-000000000002";
const SUBJECT = "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te";
const DATE_26 = "Thu, 26 Nov 2026 08:24:27 +0000";
const FINAL_URL = "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/da-privati/?kxconfid=kxtest001&order=datedesc";
const NOW = "2026-11-27T10:00:00.000Z";

const b64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
function gmailMessage(id: string, o: { subject?: string; date?: string; from?: string; html?: string; text?: string } = {}) {
  return {
    id, labelIds: ["INBOX"], snippet: "Ci sono nuovi risultati per la tua ricerca!",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: o.from ?? "Subito <noreply@subito.it>" },
        { name: "Subject", value: o.subject ?? SUBJECT },
        { name: "Date", value: o.date ?? DATE_26 }
      ],
      parts: [
        { mimeType: "text/plain", body: { data: b64url(o.text ?? REAL_TEXT) } },
        { mimeType: "text/html", body: { data: b64url(o.html ?? REAL_HTML) } }
      ]
    }
  };
}
const pageItems = () => JSON.parse(REAL_PAGE.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)![1])
  .props.pageProps.initialState.items.originalList;
const adId = (entry: any) => String(entry.urls?.default || "").match(/-(\d{6,})\.htm/)![1];

function pageFetcher(html = REAL_PAGE, status = 200) {
  const calls: string[] = [];
  return { calls, fetchPage: (url: string) => { calls.push(url); return Promise.resolve({ status, finalUrl: FINAL_URL, html }); } };
}
async function run(seed: Record<string, any[]> = {}, options: { html?: string; message?: any; status?: number } = {}) {
  const fake = fakeSupabase(seed);
  const before = structuredClone(fake.tables);
  const db = readOnlyDb(fake.client);
  const page = pageFetcher(options.html, options.status);
  const report = await subitoDryRun({ message: options.message ?? gmailMessage("real-26"), db, owner: OWNER, fetchPage: page.fetchPage, nowIso: NOW });
  return { report, fake, before, page, db };
}
function assertNoWrites(fake: ReturnType<typeof fakeSupabase>, before: any, label: string) {
  eq(fake.state.writes, 0, label + ": nessuna scrittura nel database");
  eq(fake.state.rpcCalls.length, 0, label + ": nessuna RPC");
  // Il database simulato crea una tabella vuota alla prima lettura: ammessa solo se vuota.
  for (const [name, rows] of Object.entries(fake.tables)) {
    eq(JSON.stringify(rows), JSON.stringify(before[name] ?? []), label + ": tabella " + name + " identica a prima della prova");
  }
}

Deno.test("email reale del 26/11, nessun dato in NMRE: ogni annuncio plausibile ha una scheda «Da verificare» proposta, zero scritture", async () => {
  const { report, fake, before, page } = await run();
  assertNoWrites(fake, before, "email reale");
  eq(page.calls.length, 1, "una sola lettura della pagina");
  eq(/kxconfid=/.test(page.calls[0]), true, "kxconfid conservato nella richiesta");
  eq(report.esito, "novita_non_dimostrabile", "senza email precedente la novità non è dimostrabile");
  eq(report.decisione?.motivo, "nessuna_notifica_precedente", "motivo");
  eq(report.email?.annunci_dichiarati, 3, "annunci dichiarati dall'email");
  eq(report.email?.kxconfid_conservato, true, "kxconfid conservato");
  eq(report.annunci.length, pageItems().length, "tutti gli annunci della pagina elencati");
  const proposed = report.annunci.filter(a => a.decisione === "proposta_scheda_da_verificare");
  eq(proposed.length > 0, true, "almeno un annuncio proposto");
  for (const a of report.annunci) {
    eq(/^https:\/\/www\.subito\.it\/.+-\d{6,}\.htm$/.test(a.url), true, "URL diretto " + a.id);
    eq(a.url.endsWith("-" + a.id + ".htm"), true, "URL coerente con l'ID " + a.id);
    eq(typeof a.titolo === "string" && a.titolo.length > 0, true, "titolo " + a.id);
  }
  for (const a of proposed) {
    eq(a.anteprima?.stato, "da_verificare", "scheda proposta Da verificare " + a.id);
    eq(a.anteprima?.dedup_key, "subito:" + a.id, "chiave della scheda individuale " + a.id);
    eq(a.anteprima?.novita_non_dimostrata, true, "segnata come novità non dimostrata " + a.id);
  }
  eq(report.riepilogo.creerebbe_candidato, 0, "nessun annuncio dichiarato nuovo con certezza");
});

Deno.test("con l'email precedente della stessa ricerca: 6 nella finestra contro 3 dichiarati, nessuna certezza, schede proposte", async () => {
  const searchKey = (await run()).report.email!.ricerca!;
  const previousDigest = {
    owner_id: OWNER, dedup_key: "gmail:prev-25", stato: "da_verificare", data_pubblicazione: "2026-11-25T08:24:00.000Z",
    dati_fonte: { ricerca_subito: searchKey }, dati_estratti: {}
  };
  const { report, fake, before } = await run({ annunci_candidati: [previousDigest] });
  assertNoWrites(fake, before, "con email precedente");
  eq(report.decisione?.certa, false, "novità non certa");
  eq(report.decisione?.motivo, "conteggio_diverso", "conteggio diverso da quello dichiarato");
  eq(report.decisione?.nella_finestra, 6, "6 annunci nella finestra");
  eq(report.riepilogo.proposta_scheda_da_verificare, 6, "6 schede individuali proposte");
});

Deno.test("annunci già presenti: Opportunità (anche scartate e manuali) e Archivio riconosciuti, dati manuali intatti", async () => {
  const ids = pageItems().map(adId);
  const seed = {
    annunci_candidati: [
      { owner_id: OWNER, dedup_key: "subito:" + ids[0], stato: "scartato", tipo_venditore: "Agenzia", seller_manual_override: true, titolo: "Titolo manuale", prezzo: 123 },
      { owner_id: OWNER, dedup_key: "gmail:altro", listing_key: "subito.it/appartamenti/qualsiasi-" + ids[1] + ".htm", stato: "confermato", tipo_venditore: "Privato" },
      { owner_id: OWNER, dedup_key: "manuale:1", url: "https://www.subito.it/appartamenti/inserito-a-mano-" + ids[2] + ".htm", stato: "da_verificare" }
    ],
    annunci: [{ owner_id: OWNER, url: "https://www.subito.it/appartamenti/archivio-" + ids[3] + ".htm", deleted_at: null }]
  };
  const { report, fake, before } = await run(seed);
  assertNoWrites(fake, before, "annunci già presenti");
  const byId = new Map(report.annunci.map(a => [a.id, a]));
  eq(byId.get(ids[0])?.decisione, "gia_nelle_opportunita", "scartato manualmente: già presente");
  eq(byId.get(ids[0])?.gia_presente.opportunita?.manuale, true, "decisione manuale riconosciuta");
  eq(byId.get(ids[1])?.decisione, "gia_nelle_opportunita", "stesso annuncio con titolo diverso nell'URL");
  eq(byId.get(ids[2])?.decisione, "gia_nelle_opportunita", "candidato inserito con l'URL");
  eq(byId.get(ids[3])?.decisione, "gia_in_archivio", "immobile inserito a mano nell'Archivio");
  eq(fake.tables.annunci_candidati[0].titolo, "Titolo manuale", "titolo manuale invariato");
  eq(fake.tables.annunci_candidati[0].stato, "scartato", "stato manuale invariato");
  for (const id of ids.slice(0, 4)) eq(byId.get(id)?.anteprima, null, "nessuna proposta per un annuncio già presente " + id);
});

Deno.test("pagina protetta da verifica anti-robot: nessun aggiramento, nessun annuncio, nessuna scrittura", async () => {
  const { report, fake, before, page } = await run({}, { html: CAPTCHA_PAGE });
  assertNoWrites(fake, before, "pagina bloccata");
  eq(page.calls.length, 1, "una sola richiesta, nessun nuovo tentativo");
  eq(report.esito, "pagina_non_disponibile", "esito");
  eq(report.pagina?.motivo, "pagina_bloccata", "motivo");
  eq(report.annunci.length, 0, "nessun annuncio");
});

Deno.test("HTTP 403 reale da Subito: una sola richiesta, nessun tentativo alternativo e nessuna scrittura", async () => {
  const { report, fake, before, page } = await run({}, { status: 403, html: "<html><title>Forbidden</title></html>" });
  assertNoWrites(fake, before, "HTTP 403 Subito");
  eq(page.calls.length, 1, "una sola richiesta alla prima pagina");
  eq(report.esito, "pagina_non_disponibile", "esito per HTTP 403");
  eq(report.pagina?.http, 403, "codice HTTP conservato nel rapporto");
  eq(report.pagina?.motivo, "pagina_bloccata", "blocco esplicito");
  eq(report.annunci.length, 0, "nessun annuncio proposto");
  eq(report.riepilogo.creerebbe_candidato + report.riepilogo.proposta_scheda_da_verificare, 0, "nessuna proposta");
});

Deno.test("confronto con il database non riuscito: nessun annuncio proposto", async () => {
  const fake = fakeSupabase();
  fake.state.fail = (table, op) => table === "annunci" && op === "select" ? { message: "timeout" } : null;
  const before = structuredClone(fake.tables);
  const report = await subitoDryRun({ message: gmailMessage("real-26"), db: readOnlyDb(fake.client), owner: OWNER, fetchPage: pageFetcher().fetchPage, nowIso: NOW });
  assertNoWrites(fake, before, "errore di lettura");
  eq(report.success, false, "prova non riuscita");
  eq(report.esito, "confronto_non_riuscito", "esito");
  eq(report.riepilogo.proposta_scheda_da_verificare + report.riepilogo.creerebbe_candidato, 0, "nessuna proposta");
  eq(report.annunci.every(a => a.anteprima === null), true, "nessuna anteprima");
});

Deno.test("email che non è una ricerca salvata Subito: nessuna elaborazione e nessuna lettura della pagina", async () => {
  const other = gmailMessage("x1", { from: "Immobiliare.it <noreply@immobiliare.it>", subject: "Nuovo annuncio", text: "Nuovo annuncio https://www.immobiliare.it/annunci/123456789/", html: "" });
  const { report, fake, before, page } = await run({}, { message: other });
  assertNoWrites(fake, before, "email non Subito");
  eq(report.esito, "non_ricerca_salvata", "esito");
  eq(page.calls.length, 0, "pagina non letta");
});

Deno.test("rapporto leggibile: elenco degli annunci senza corpo dell'email", async () => {
  const { report } = await run();
  const text = reportText(report);
  eq(/PROVA SENZA SCRITTURE/.test(text), true, "intestazione");
  for (const a of report.annunci) eq(text.includes(a.url), true, "link nel rapporto " + a.id);
  eq(text.includes("Lo Staff di Subito"), false, "nessun testo dell'email");
  eq(JSON.stringify(report).includes("Lo Staff di Subito"), false, "nessun testo dell'email nel JSON");
});

// ---------- Selezione dell'unica email ----------

function fakeGmail(messages: any[]) {
  const urls: string[] = [];
  const fetcher = (url: string, init: { method: string }) => {
    urls.push(init.method + " " + url);
    const path = url.replace("https://gmail.googleapis.com/gmail/v1/users/me/", "");
    if (path.startsWith("messages?")) return Promise.resolve(Response.json({ messages: messages.map(m => ({ id: m.id })) }));
    const id = decodeURIComponent(path.slice("messages/".length).split("?")[0]);
    const message = messages.find(m => m.id === id);
    return Promise.resolve(message ? Response.json(message) : new Response("", { status: 404 }));
  };
  return { urls, gmail: readOnlyGmail("token-di-prova", fetcher as any) };
}
const request = (extra: Record<string, unknown> = {}) => {
  const v = validateRequest({ subject: SUBJECT, received_on: "2026-11-26", ...extra });
  if (!v.ok) throw new Error(v.reason);
  return v.request;
};

Deno.test("selezione: una sola email corrispondente (mittente, oggetto esatto, giorno in ora italiana)", async () => {
  const { gmail, urls } = fakeGmail([
    gmailMessage("aaaa1111bbbb2222"),
    gmailMessage("cccc3333dddd4444", { subject: "Altra ricerca ha 2 nuovi annunci per te" }),
    gmailMessage("eeee5555ffff6666", { date: "Wed, 25 Nov 2026 08:24:00 +0000" })
  ]);
  const result = await selectEmail(gmail, request());
  eq(result.ok, true, "email individuata");
  if (result.ok) eq(result.message.id, "aaaa1111bbbb2222", "email giusta");
  eq(urls.every(u => u.startsWith("GET ")), true, "solo richieste GET");
  eq(urls.filter(u => u.includes("format=full")).length, 1, "un solo messaggio letto per intero");
  eq(/q=from%3Asubito\.it/.test(urls[0]) && /maxResults=10/.test(urls[0]), true, "elenco limitato a subito.it e a 10 risultati");
});

Deno.test("selezione: nessuna o più corrispondenze, oppure message_id con oggetto diverso → nessuna email elaborata", async () => {
  const none = await selectEmail(fakeGmail([gmailMessage("cccc3333dddd4444", { subject: "Altro" })]).gmail, request());
  eq(none.ok, false, "nessuna corrispondenza");
  const two = fakeGmail([gmailMessage("aaaa1111bbbb2222"), gmailMessage("bbbb1111cccc2222")]);
  const many = await selectEmail(two.gmail, request());
  eq(many.ok, false, "due corrispondenze");
  eq(two.urls.some(u => u.includes("format=full")), false, "nessun messaggio letto per intero");
  const wrong = await selectEmail(fakeGmail([gmailMessage("aaaa1111bbbb2222", { subject: "Altro oggetto" })]).gmail, request({ message_id: "aaaa1111bbbb2222" }));
  eq(wrong.ok, false, "message_id con oggetto diverso rifiutato");
  const notSubito = await selectEmail(fakeGmail([gmailMessage("aaaa1111bbbb2222", { from: "Altro <x@example.com>" })]).gmail, request({ message_id: "aaaa1111bbbb2222" }));
  eq(notSubito.ok, false, "mittente diverso da Subito rifiutato");
});

Deno.test("richiesta: oggetto e giorno obbligatori, message_id valido", () => {
  eq(validateRequest({}).ok, false, "vuota");
  eq(validateRequest({ subject: SUBJECT, received_on: "26/11/2026" }).ok, false, "giorno nel formato sbagliato");
  eq(validateRequest({ subject: SUBJECT, received_on: "2026-11-26", message_id: "../modify" }).ok, false, "message_id non valido");
  eq(validateRequest({ subject: SUBJECT, received_on: "2026-11-26" }).ok, true, "valida");
});

// ---------- Verifiche aggiuntive: nessuna opportunità persa, duplicati, sola lettura ----------

const EMAIL_LIMIT_MS = Date.parse("2026-11-26T08:24:27Z") + 5 * 60 * 1000;

Deno.test("ogni annuncio plausibile è una scheda «Da verificare» proposta, anche oltre il limite di 15 e anche se professionale", async () => {
  const { report } = await run();
  const plausible = pageItems().filter((entry: any) => {
    const item = report.annunci.find(a => a.id === adId(entry))!;
    return !item.pubblicato_il || Date.parse(item.pubblicato_il) <= EMAIL_LIMIT_MS;
  });
  const proposed = report.annunci.filter(a => a.decisione === "proposta_scheda_da_verificare");
  eq(proposed.length, plausible.length, "tutti gli annunci plausibili proposti");
  eq(report.annunci.filter(a => a.oltre_limite_proposte).length, Math.max(0, plausible.length - 15), "quelli oltre il limite della decisione restano proposti");
  eq(proposed.every(a => a.anteprima?.stato === "da_verificare"), true, "nessuna proposta scartata: tutte «Da verificare»");
  eq(proposed.some(a => a.inserzionista.startsWith("Professionista")), true, "anche gli annunci professionali sono proposti, non scartati");
  eq(report.annunci.filter(a => a.decisione === "nessuna_proposta").every(a => a.categoria === "successivo_all_email" || a.categoria === "anteriore_alla_finestra"),
    true, "nessuna proposta solo per annunci fuori dalla finestra dell'email");
});

Deno.test("annunci Subito riconosciuti esattamente come nella pagina reale (ID, URL, titolo, prezzo)", async () => {
  const { report } = await run();
  const raw = pageItems();
  eq(report.annunci.map(a => a.id), raw.map(adId), "stessi ID, stesso ordine");
  eq(new Set(report.annunci.map(a => a.id)).size, report.annunci.length, "nessun annuncio ripetuto");
  for (const [index, entry] of raw.entries()) {
    const a = report.annunci[index];
    eq(a.url, entry.urls.default, "URL diretto " + a.id);
    eq(a.titolo, String(entry.subject).replace(/\s+/g, " ").trim(), "titolo " + a.id);
    eq(a.prezzo === null || typeof a.prezzo === "number", true, "prezzo numerico o assente " + a.id);
  }
});

Deno.test("duplicati: Archivio eliminato, Archivio per listing_key, presenza sia in Opportunità sia in Archivio", async () => {
  const ids = pageItems().map(adId);
  const seed = {
    annunci_candidati: [{ owner_id: OWNER, dedup_key: "subito:" + ids[5], stato: "confermato", tipo_venditore: "Privato" }],
    annunci: [
      { owner_id: OWNER, url: "https://www.subito.it/appartamenti/eliminato-" + ids[4] + ".htm", deleted_at: "2026-11-20T10:00:00Z" },
      { owner_id: OWNER, listing_key: "subito.it/appartamenti/archiviato-" + ids[6] + ".htm", deleted_at: null },
      { owner_id: OWNER, url: "https://www.subito.it/appartamenti/doppio-" + ids[5] + ".htm", deleted_at: null }
    ]
  };
  const { report, fake, before } = await run(seed);
  assertNoWrites(fake, before, "duplicati");
  const byId = new Map(report.annunci.map(a => [a.id, a]));
  eq([byId.get(ids[4])?.decisione, byId.get(ids[4])?.gia_presente.archivio?.eliminato], ["gia_in_archivio", true], "eliminato dall'Archivio: non riproposto");
  eq(byId.get(ids[6])?.decisione, "gia_in_archivio", "archiviato da NMRE (listing_key)");
  eq(byId.get(ids[5])?.decisione, "gia_nelle_opportunita", "presente in entrambi: prevale l'Opportunità");
  eq(!!byId.get(ids[5])?.gia_presente.archivio, true, "e il rapporto mostra anche la presenza in Archivio");
});

Deno.test("email già registrata in NMRE: segnalata nel rapporto, nessuna scrittura", async () => {
  const digest = { owner_id: OWNER, dedup_key: "gmail:real-26", stato: "da_verificare", dati_estratti: { ricerca_subito: { tentativi: 2 } } };
  const { report, fake, before } = await run({ annunci_candidati: [digest] });
  assertNoWrites(fake, before, "email registrata");
  eq(report.email?.gia_registrata_in_nmre, true, "email già registrata");
  eq((await run()).report.email?.gia_registrata_in_nmre, false, "email non registrata");
});

Deno.test("sola lettura: sul client del database vengono chiamati solo metodi di lettura", async () => {
  const fake = fakeSupabase();
  const called = new Set<string>();
  const spy = (target: any): any => new Proxy(target, {
    get(object, property) {
      const value = object[property];
      if (typeof value !== "function" || property === "then") return typeof value === "function" ? value.bind(object) : value;
      return (...args: unknown[]) => { called.add(String(property)); const result = value.apply(object, args); return result && typeof result === "object" ? spy(result) : result; };
    }
  });
  const admin = { from: (table: string) => { called.add("from:" + table); return spy(fake.client.from(table)); }, rpc: () => { called.add("rpc"); return Promise.resolve({ data: null, error: null }); } };
  const report = await subitoDryRun({ message: gmailMessage("real-26"), db: readOnlyDb(admin), owner: OWNER, fetchPage: pageFetcher().fetchPage, nowIso: NOW });
  eq(report.annunci.length > 0, true, "prova completata");
  const allowed = new Set(["from:annunci_candidati", "from:annunci", "select", "eq", "like", "lt", "order", "limit", "maybeSingle"]);
  const unexpected = [...called].filter(name => !allowed.has(name));
  eq(unexpected, [], "nessun metodo diverso dalle letture");
  eq(fake.state.writes, 0, "nessuna scrittura");
});

Deno.test("selezione: la ricerca Gmail è ristretta a mittente, oggetto e giorni attorno alla data", async () => {
  const { gmail, urls } = fakeGmail([gmailMessage("aaaa1111bbbb2222")]);
  await selectEmail(gmail, request());
  const query = new URL(urls[0].slice(4)).searchParams.get("q") || "";
  eq(query.startsWith("from:subito.it subject:\"" + SUBJECT + "\" after:"), true, "query con oggetto esatto: " + query);
});
