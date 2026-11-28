// Prova senza scritture dell'intera ricerca (modalita "intera_ricerca"): database simulato
// avvolto in readOnlyDb (ogni scrittura solleva un errore), email reale del 26/11/2026 e
// pagine costruite dalla struttura reale. Uso: deno test --allow-read=. supabase/functions/nmre-subito-dry-run/full_search_dry_run_test.ts
import { readOnlyDb } from "./readonly.ts";
import { fullSearchReportText, subitoFullSearchDryRun } from "./full_search_dry_run.ts";
import { validateRequest } from "./dry_run.ts";
import { fakeSupabase } from "../nmre-gmail-scheduled/fake_supabase.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
}
const fixture = (name: string) => Deno.readTextFileSync(new URL("../nmre-gmail-scheduled/fixtures/" + name, import.meta.url));
const REAL_PAGE = fixture("subito_real_results_page.html");
const b64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const MESSAGE = { id: "real-26", labelIds: ["INBOX"], snippet: "Ci sono nuovi risultati per la tua ricerca!", payload: {
  mimeType: "multipart/alternative",
  headers: [{ name: "From", value: "Subito <noreply@subito.it>" }, { name: "Subject", value: "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te" },
    { name: "Date", value: "Thu, 26 Nov 2026 08:24:27 +0000" }],
  parts: [{ mimeType: "text/plain", body: { data: b64url(fixture("subito_real_email.txt")) } }, { mimeType: "text/html", body: { data: b64url(fixture("subito_real_email.html")) } }]
} };
const OWNER = "00000000-0000-4000-8000-000000000002";
const NEXT_RE = /(<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>)([\s\S]*?)(<\/script>)/i;
const REAL_DATA = JSON.parse(REAL_PAGE.match(NEXT_RE)![2]);
function page(number: number, totalPages: number, idsList: string[]): string {
  const data = structuredClone(REAL_DATA);
  const items = data.props.pageProps.initialState.items;
  const template = items.originalList[0];
  items.originalList = idsList.map(id => {
    const entry = structuredClone(template);
    const target = entry.item && !entry.urls ? entry.item : entry;
    target.urls = { default: "https://www.subito.it/appartamenti/prova-" + id + ".htm" };
    target.advertiser = { company: false };
    return entry;
  });
  items.totalPages = totalPages; items.total = totalPages * idsList.length;
  data.props.pageProps.initialState.search.page = number;
  return REAL_PAGE.replace(NEXT_RE, (_m, a, _j, c) => a + JSON.stringify(data) + c);
}
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => String(710000000 + from + i));

Deno.test("modalita: singola email per impostazione predefinita, intera ricerca su richiesta, altri valori rifiutati", () => {
  const base = { subject: "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te", received_on: "2026-11-26" };
  eq((validateRequest(base) as Any).request.modalita, "singola_email", "predefinita");
  eq((validateRequest({ ...base, modalita: "intera_ricerca" }) as Any).request.modalita, "intera_ricerca", "intera ricerca");
  eq(validateRequest({ ...base, modalita: "importa" }).ok, false, "valore sconosciuto rifiutato");
});

Deno.test("intera ricerca: tutte le pagine lette, deduplicazione, notifiche previste, NESSUNA scrittura", async () => {
  const [known, archived] = ids(0, 2);
  const db = fakeSupabase({
    annunci_candidati: [{ owner_id: OWNER, stato: "da_verificare", dedup_key: "subito:" + known, listing_key: "subito.it/appartamenti/prova-" + known + ".htm", source_email_id: "x", dati_estratti: {} }],
    annunci: [{ owner_id: OWNER, url: "https://www.subito.it/appartamenti/altro-" + archived + ".htm", listing_key: null, deleted_at: null }]
  });
  const before = JSON.stringify(db.tables);
  const requested: string[] = [];
  const report = await subitoFullSearchDryRun({
    message: MESSAGE, db: readOnlyDb(db.client), owner: OWNER,
    fetchPage: url => { requested.push(url); const n = Number(new URL(url).searchParams.get("o") || "1"); return Promise.resolve({ status: 200, finalUrl: url, html: page(n, 3, ids((n - 1) * 30, 30)) }); }
  });
  eq(requested.length, 3, "tre pagine richieste");
  eq([report.esito, report.lettura?.pagine_lette, report.lettura?.pagine_dichiarate, report.lettura?.annunci_letti], ["ricerca_letta_completa", 3, 3, 90], "lettura completa");
  eq([report.riepilogo.creerebbe_scheda, report.riepilogo.gia_nelle_opportunita, report.riepilogo.gia_in_archivio], [88, 1, 1], "deduplicazione");
  eq(report.notifiche_previste, { singole: 0, riepilogative: 1, raggruppate: true }, "88 nuove: una sola notifica riepilogativa prevista");
  eq(report.ricerca?.filtro_venditore, "privati", "filtro privati rilevato nel link");
  eq(JSON.stringify(db.tables), before, "database invariato");
  eq(db.state.writes, 0, "nessuna scrittura");
  eq(/Nessuna scrittura eseguita/.test(fullSearchReportText(report)), true, "rapporto leggibile");
});

Deno.test("intera ricerca bloccata da Subito: esito chiaro, nessuna supposizione", async () => {
  const db = fakeSupabase();
  const report = await subitoFullSearchDryRun({ message: MESSAGE, db: readOnlyDb(db.client), owner: OWNER,
    fetchPage: url => Promise.resolve({ status: 403, finalUrl: url, html: "<html>Access denied</html>" }) });
  eq([report.success, report.esito, report.lettura?.motivo, report.lettura?.richieste[0].http], [false, "ricerca_non_disponibile", "pagina_bloccata", 403], "403 registrato");
  eq(report.annunci.length, 0, "nessun annuncio inventato");
});

Deno.test("pagina reale: 30 annunci, 9 pagine dichiarate; pagina 2 non disponibile = lettura parziale", async () => {
  const db = fakeSupabase();
  const report = await subitoFullSearchDryRun({ message: MESSAGE, db: readOnlyDb(db.client), owner: OWNER,
    fetchPage: url => Promise.resolve(new URL(url).searchParams.get("o") ? { status: 403, finalUrl: url, html: "" } : { status: 200, finalUrl: url, html: REAL_PAGE }) });
  eq([report.esito, report.lettura?.annunci_letti, report.lettura?.pagine_dichiarate], ["ricerca_letta_in_parte", 30, 9], "parziale");
  eq(report.riepilogo.professionali > 0 && report.riepilogo.privati + report.riepilogo.da_verificare === 30, true, "classificazione su tutti i 30 annunci");
});
