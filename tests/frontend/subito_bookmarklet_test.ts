// Pulsante NMRE per Subito (bookmarklet) e collegamento alla notifica Gmail.
// Esegue il codice REALE del pulsante (estratto da index.html) su un DOM simulato con la
// pagina dei risultati reale del 26/11/2026, e confronta il risultato con il parser del server.
// Verifica: nessuna richiesta di rete, accumulo manuale tra pagine, nessun dato inventato,
// riconoscimento della ricerca della notifica, compatibilità con l'importatore.
// Uso: deno test --allow-read=. tests/frontend/subito_bookmarklet_test.ts
import { parseSubitoResultsPage, subitoSearchKey } from "../../supabase/functions/nmre-gmail-scheduled/_shared/subito.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
  }
}
const root = new URL("../../", import.meta.url);
const html = Deno.readTextFileSync(new URL("index.html", root));
const REAL_PAGE = Deno.readTextFileSync(new URL("supabase/functions/nmre-gmail-scheduled/fixtures/subito_real_results_page.html", root));
const EMAIL_SEARCH_URL = "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&kxconfid=kxtest001&order=datedesc";
const PAGE_URL = "https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/da-privati/?kxconfid=kxtest001&order=datedesc";

function grab(name: string): string {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  let depth = 0;
  for (let index = html.indexOf("){", start) + 1; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}
const constLine = (name: string) => (html.match(new RegExp("const " + name + "=[^\\n]+;")) || [""])[0];

// ---------- Pagine e DOM simulati ----------
const NEXT_RE = /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const REAL_DATA = JSON.parse(REAL_PAGE.match(NEXT_RE)![1]);
function pageData(page: number, ids?: string[], extra: (data: Any) => void = () => {}) {
  const data = structuredClone(REAL_DATA);
  const state = data.props.pageProps.initialState;
  state.search.page = page;
  if (ids) {
    const template = state.items.originalList[0];
    state.items.originalList = ids.map(id => {
      const entry = structuredClone(template);
      const target = entry.item && !entry.urls ? entry.item : entry;
      target.urls = { default: "https://www.subito.it/appartamenti/prova-" + id + ".htm" };
      return entry;
    });
  }
  extra(data);
  return JSON.stringify(data);
}
type Env = { href: string; nextData: string | null; confirmAnswer?: boolean; storage?: Map<string, string> };
function run(env: Env) {
  const alerts: string[] = [], confirms: string[] = [], network: string[] = [];
  const storage = env.storage ?? new Map<string, string>();
  const appended: Any[] = [];
  let clipboard: string | null = null;
  // deno-lint-ignore no-explicit-any
  const element = (tag: string): any => {
    const node: Any = { tagName: tag, children: [] as Any[], style: {}, textContent: "", value: "", attrs: {} as Record<string, string>, listeners: {} as Record<string, () => void> };
    node.setAttribute = (k: string, v: string) => { node.attrs[k] = v; };
    node.appendChild = (child: Any) => { node.children.push(child); return child; };
    node.addEventListener = (type: string, fn: () => void) => { node.listeners[type] = fn; };
    node.remove = () => { const i = appended.indexOf(node); if (i >= 0) appended.splice(i, 1); };
    node.focus = () => {}; node.select = () => {};
    Object.defineProperty(node, "innerHTML", { set() { throw new Error("innerHTML usato dal pulsante NMRE"); } });
    return node;
  };
  const document = {
    getElementById: (id: string) => id === "__NEXT_DATA__" ? (env.nextData === null ? null : { textContent: env.nextData })
      : id === "nmre-subito-panel" ? appended.find(n => n.id === "nmre-subito-panel") || null : null,
    createElement: element,
    body: { appendChild: (node: Any) => { appended.push(node); return node; } }
  };
  const blocked = (name: string) => () => { network.push(name); throw new Error("richiesta di rete vietata: " + name); };
  const sandbox = {
    location: new URL(env.href), document,
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
    alert: (m: string) => { alerts.push(m); }, confirm: (m: string) => { confirms.push(m); return env.confirmAnswer ?? false; },
    navigator: { clipboard: { writeText: (text: string) => { clipboard = text; return Promise.resolve(); } } },
    fetch: blocked("fetch"), XMLHttpRequest: blocked("XMLHttpRequest"), WebSocket: blocked("WebSocket"), EventSource: blocked("EventSource"),
    open: blocked("window.open"), URL
  };
  const fn = new Function(...Object.keys(sandbox), grab("nmreSubitoBookmarkletMain") + "\nreturn nmreSubitoBookmarkletMain();");
  fn(...Object.values(sandbox));
  const raw = storage.get("nmre-subito-accumulo-v1");
  const panel = appended.find(n => n.id === "nmre-subito-panel") || null;
  const copy = async () => { panel?.children.find((c: Any) => c.textContent === "Copia per NMRE")?.listeners.click(); await Promise.resolve(); return clipboard; };
  return { alerts, confirms, network, storage, acc: raw ? JSON.parse(raw) : null, panel, panelText: panel ? panel.children.map((c: Any) => c.textContent).join(" | ") : "", copy };
}

// Funzioni dell'app (importatore e verifica della ricerca) estratte da index.html.
function validUrl(value: unknown) { try { const u = new URL(String(value || "")); return ["http:", "https:"].includes(u.protocol) ? u.href : null; } catch { return null; } }
const app = new Function("validUrl",
  constLine("NMRE_SUBITO_KEY_IGNORED") + "\n" +
  ["nmreSubitoBrowserAdId", "nmreSubitoDateIso", "nmreParseSubitoBrowserPayload", "nmreSubitoSearchKey", "nmreSubitoSearchMatches"].map(grab).join("\n") +
  "\nreturn {nmreParseSubitoBrowserPayload,nmreSubitoSearchKey,nmreSubitoSearchMatches,nmreSubitoBrowserAdId,nmreSubitoDateIso};"
)(validUrl);

// ---------- Test ----------

Deno.test("codice del pulsante: nessuna richiesta di rete, nessuna apertura di pagine, nessun innerHTML", () => {
  const source = grab("nmreSubitoBookmarkletMain");
  for (const [pattern, label] of [
    [/\bfetch\s*\(/, "fetch"], [/XMLHttpRequest/, "XMLHttpRequest"], [/sendBeacon/, "sendBeacon"], [/WebSocket|EventSource/, "socket"],
    [/window\.open|\.open\s*\(/, "apertura di finestre"], [/location\.(?:assign|replace|href\s*=)/, "navigazione"], [/\bimport\s*\(|\beval\s*\(|new Function/, "codice dinamico"],
    [/innerHTML|outerHTML|insertAdjacentHTML/, "HTML non sicuro"], [/\.click\s*\(\s*\)/, "clic automatici"], [/setInterval|setTimeout/, "esecuzioni ripetute"]
  ] as const) eq(pattern.test(source), false, "il pulsante non usa " + label);
  eq(/nmreSubitoBookmarkletHref/.test(html) && /"javascript:"\+encodeURIComponent/.test(html), true, "link del pulsante generato dal codice reale");
});

Deno.test("pagina reale del 26/11: 30 annunci, stessi ID e dati del parser del server, nessun dato inventato", async () => {
  const result = run({ href: PAGE_URL, nextData: REAL_PAGE.match(NEXT_RE)![1] });
  eq([result.alerts, result.network], [[], []], "nessun avviso e nessuna richiesta di rete");
  const server = parseSubitoResultsPage(REAL_PAGE).items;
  eq(result.acc.items.map((i: Any) => i.id), server.map(i => i.id), "stessi 30 ID del server, stesso ordine");
  // Confronto dopo l'importatore dell'app (che normalizza gli spazi come il server).
  const imported = app.nmreParseSubitoBrowserPayload(JSON.stringify(result.acc)).items;
  for (const [index, item] of imported.entries()) {
    const s = server[index];
    eq([item.url, item.price, item.location, item.surface_mq, item.advertiser_company], [s.url, s.price, s.location, s.surfaceMq, s.advertiserCompany], "dati dell'annuncio " + item.id);
    eq([item.title, item.description, item.published_at], [s.title, s.description, s.publishedAt], "titolo, descrizione e data " + item.id);
  }
  eq([result.acc.pages, result.acc.total, result.acc.total_pages], [[1], 263, 9], "pagina 1 di 9, 263 dichiarati");
  eq(result.acc.search_filters.advt, "0,2", "filtri dichiarati dalla pagina conservati");
  eq(result.acc.search_url.includes("kxconfid=kxtest001"), true, "link della ricerca con kxconfid");
  eq(/utm_|[?&]o=/.test(result.acc.search_url), false, "senza pagina né campagna");
  eq(/30 annunci letti, 30 nuovi/.test(result.panelText) && /Raccolti finora: 30 annunci da 1 pagine/.test(result.panelText), true, "riepilogo nel pannello");
  const copied = await result.copy();
  eq(JSON.parse(copied!).items.length, 30, "copia per NMRE");
});

Deno.test("accumulo manuale: pagina 2 aggiunta senza doppioni, stessa pagina due volte ignorata", () => {
  const storage = new Map<string, string>();
  run({ href: PAGE_URL, nextData: pageData(1, ["700000001", "700000002"]), storage });
  const second = run({ href: PAGE_URL + "&o=2", nextData: pageData(2, ["700000002", "700000003"]), storage });
  eq(second.acc.items.map((i: Any) => i.id), ["700000001", "700000002", "700000003"], "tre annunci, nessun doppione");
  eq(second.acc.pages, [1, 2], "pagine 1 e 2");
  const again = run({ href: PAGE_URL + "&o=2", nextData: pageData(2, ["700000002", "700000003"]), storage });
  eq([again.acc.items.length, again.acc.pages], [3, [1, 2]], "pagina ripetuta: nulla di nuovo");
  eq(/0 nuovi in questa raccolta/.test(again.panelText), true, "il pannello lo dice");
});

Deno.test("pagina cambiata senza ricaricare (dati ancora della pagina 1): nessun dato raccolto, invito a ricaricare", () => {
  const storage = new Map<string, string>();
  const result = run({ href: PAGE_URL + "&o=2", nextData: pageData(1, ["700000001"]), storage });
  eq(result.acc, null, "nulla accumulato");
  eq(/Ricarichi la pagina/.test(result.alerts[0] || ""), true, "invito a ricaricare");
});

Deno.test("ricerca diversa durante la raccolta: chiede conferma; senza conferma nulla cambia", () => {
  const storage = new Map<string, string>();
  run({ href: PAGE_URL, nextData: pageData(1, ["700000001"]), storage });
  const otherUrl = "https://www.subito.it/annunci-marche/vendita/appartamenti/osimo/?advt=0%2C2";
  const refused = run({ href: otherUrl, nextData: pageData(1, ["700000009"]), storage, confirmAnswer: false });
  eq([refused.confirms.length, refused.acc.items.map((i: Any) => i.id)], [1, ["700000001"]], "senza conferma: raccolta precedente intatta");
  const restarted = run({ href: otherUrl, nextData: pageData(1, ["700000009"]), storage, confirmAnswer: true });
  eq(restarted.acc.items.map((i: Any) => i.id), ["700000009"], "con conferma: nuova raccolta");
});

Deno.test("contenuti non riconosciuti o incompleti: nessuna invenzione", () => {
  const notSubito = run({ href: "https://www.esempio.it/annunci", nextData: pageData(1) });
  eq([notSubito.acc, /solo su una pagina dei risultati di Subito/.test(notSubito.alerts[0])], [null, true], "sito diverso");
  const noData = run({ href: PAGE_URL, nextData: null });
  eq([noData.acc, /elenco dei risultati non trovato/.test(noData.alerts[0])], [null, true], "pagina senza dati");
  const broken = run({ href: PAGE_URL, nextData: "{non json" });
  eq(broken.acc, null, "dati non leggibili");
  const mixed = run({ href: PAGE_URL, nextData: pageData(1, ["700000001"], (data: Any) => {
    const list = data.props.pageProps.initialState.items.originalList;
    const base = list[0];
    const slugless = structuredClone(base); (slugless.item && !slugless.urls ? slugless.item : slugless).urls = { default: "https://www.subito.it/appartamenti/700000002.htm" };
    const foreign = structuredClone(base); (foreign.item && !foreign.urls ? foreign.item : foreign).urls = { default: "https://www.esempio.it/appartamenti/x-700000003.htm" };
    const promo = structuredClone(base); promo.kind = "BoostedItem"; (promo.item && !promo.urls ? promo.item : promo).urls = { default: "https://www.subito.it/appartamenti/promo-700000004.htm" };
    const bare = { kind: "AdItem", urls: { default: "https://www.subito.it/appartamenti/solo-link-700000005.htm" } };
    list.push(slugless, foreign, promo, bare);
  }) });
  eq(mixed.acc.items.map((i: Any) => i.id), ["700000001", "700000002", "700000005"], "link senza titolo accettato; dominio estraneo e annuncio promosso esclusi");
  const bare = mixed.acc.items[2];
  eq([bare.title, bare.price, bare.location, bare.surface_mq, bare.advertiser_company, bare.images], [null, null, null, null, null, []], "dati mancanti lasciati vuoti");
});

Deno.test("limite di 200 annunci per raccolta, segnalato", () => {
  const ids = Array.from({ length: 205 }, (_, i) => String(710000000 + i));
  const result = run({ href: PAGE_URL, nextData: pageData(1, ids) });
  eq(result.acc.items.length, 200, "200 conservati");
  eq(/Limite di 200 annunci raggiunto: 5 non aggiunti/.test(result.panelText), true, "limite segnalato");
});

Deno.test("dati del pulsante accettati dall'importatore e ricerca della notifica verificata", () => {
  const result = run({ href: PAGE_URL, nextData: REAL_PAGE.match(NEXT_RE)![1] });
  const parsed = app.nmreParseSubitoBrowserPayload(JSON.stringify(result.acc));
  eq([parsed.ok, parsed.items.length, parsed.meta.pages, parsed.meta.totalPages], [true, 30, [1], 9], "payload accettato");
  // Link dell'email (?advt=0%2C2) e pagina dopo il redirect di Subito (/da-privati/): stessa ricerca.
  eq(app.nmreSubitoSearchMatches(EMAIL_SEARCH_URL, parsed.meta), true, "stessa ricerca della notifica");
  eq(app.nmreSubitoSearchMatches("https://www.subito.it/annunci-marche/vendita/appartamenti/osimo/?advt=0%2C2", parsed.meta), false, "altra città: rifiutata");
  eq(app.nmreSubitoSearchMatches("https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C1", parsed.meta), false, "filtro inserzionisti diverso: rifiutata");
  eq(app.nmreSubitoSearchMatches("https://www.subito.it/annunci-marche/affitto/appartamenti/ancona/?advt=0%2C2", parsed.meta), false, "affitto invece di vendita: rifiutata");
  const noFilters = { ...parsed.meta, searchFilters: {} };
  eq(app.nmreSubitoSearchMatches(EMAIL_SEARCH_URL, { ...noFilters, searchUrl: EMAIL_SEARCH_URL.replace("kxtest001", "altro") + "&o=3" }), true, "senza filtri dichiarati: chiave della ricerca uguale");
  eq(app.nmreSubitoSearchMatches(EMAIL_SEARCH_URL, { ...noFilters, searchUrl: PAGE_URL }), false, "senza filtri dichiarati e percorso diverso: non confermata");
});

Deno.test("chiave della ricerca: stesse regole del server", () => {
  for (const url of [EMAIL_SEARCH_URL, PAGE_URL, EMAIL_SEARCH_URL + "&o=4&utm_source=x", "https://www.subito.it/annunci-italia/vendita/usato/?q=bici&advt=0"]) {
    eq(app.nmreSubitoSearchKey(url), subitoSearchKey(url), "chiave di " + url);
  }
  eq(app.nmreSubitoSearchKey("https://www.esempio.it/annunci-marche/x/"), null, "dominio estraneo");
});

Deno.test("date di Subito in ora italiana convertite come nel server, in qualunque fuso del computer", () => {
  for (const [raw, iso] of [["2026-11-26 07:33:56", "2026-11-26T06:33:56.000Z"], ["2026-07-15 12:00", "2026-07-15T10:00:00.000Z"],
    ["2026-11-26T08:00:00Z", "2026-11-26T08:00:00.000Z"], ["", null], ["ieri", null]] as const) {
    eq(app.nmreSubitoDateIso(raw), iso, "data " + JSON.stringify(raw));
  }
});

Deno.test("ID Subito anche nei link senza titolo, nell'importatore", () => {
  eq(app.nmreSubitoBrowserAdId("https://www.subito.it/appartamenti/700000002.htm"), "700000002", "senza titolo");
  eq(app.nmreSubitoBrowserAdId("https://www.subito.it/appartamenti/bilocale-ancona-700000002.htm"), "700000002", "con titolo");
  eq(app.nmreSubitoBrowserAdId("https://www.subito.it/annunci-marche/vendita/700000002.htm"), null, "pagina di ricerca, non una scheda");
  eq(app.nmreSubitoBrowserAdId("https://www.esempio.it/appartamenti/700000002.htm"), null, "dominio estraneo");
});

Deno.test("scheda della notifica Gmail: pulsante «Importa da Subito» collegato alla ricerca", () => {
  eq(/data-subito-import-link="'\+escape\(searchUrl\)\+'"/.test(html), true, "pulsante con il link della ricerca dalla notifica");
  eq(/closest\("\[data-subito-import-link\]"\)/.test(html) && /nmreLinkSubitoImport\(button\.dataset\.subitoImportLink/.test(html), true, "gestore del pulsante");
  eq(/window\.open\(nmreSubitoExpectedSearch\.url,"_blank","noopener,noreferrer"\)/.test(html), true, "apre solo la ricerca, in una nuova scheda");
  eq(/if\(nmreSubitoExpectedSearch\)\{\s*const match=nmreSubitoSearchMatches\(nmreSubitoExpectedSearch\.url,parsed\.meta\);\s*if\(match!==true\)\{\s*throw new Error/.test(html), true,
    "con la notifica collegata, dati di un'altra ricerca o non verificabili: nessuna importazione");
});

Deno.test("mobile: guida installazione, copia preferito, incolla da appunti e pagina successiva sono disponibili", () => {
  eq(html.includes('id="subitoBookmarkletMobileCopy"'), true, "copia codice per il preferito mobile");
  eq(html.includes("Installazione su iPhone e Android"), true, "guida installazione mobile");
  eq(html.includes("navigator.clipboard.readText()"), true, "incolla da appunti con gesto esplicito");
  eq(html.includes("await nmreAnalyzeSubitoBrowserPayload()"), true, "l'incolla apre solo l'analisi e l'anteprima");
  const source = grab("nmreSubitoBookmarkletMain");
  eq(source.includes("env(safe-area-inset-bottom)") && source.includes("100dvh"), true, "pannello mobile rispetta safe area e altezza viewport");
  eq(source.includes("Pagina successiva") && source.includes('nextUrl.searchParams.set("o"'), true, "link manuale alla pagina successiva");
  eq(source.includes("location.assign") || source.includes("location.replace") || source.includes(".click()"), false, "nessuna navigazione o clic automatico");
});
