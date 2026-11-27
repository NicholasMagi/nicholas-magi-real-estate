// Prova SENZA SCRITTURE dell'acquisizione dell'INTERA ricerca salvata (modalita
// "intera_ricerca"): stessa lettura delle pagine, stessa deduplicazione, stessa
// classificazione dell'inserzionista e stessa regola delle notifiche di
// nmre-gmail-scheduled con NMRE_SUBITO_FULL_SEARCH, ma con il database in sola lettura
// (readonly.ts). Il risultato è un rapporto: nessuna scheda creata, nessun registro scritto,
// nessuna notifica. Serve a verificare dal vivo, prima dell'attivazione, che Subito
// restituisca davvero tutte le pagine della ricerca.
// deno-lint-ignore-file no-explicit-any
import { emailFromGmailMessage } from "../nmre-gmail-scheduled/_shared/mailbox.ts";
import { supabaseSubitoDeps } from "../nmre-gmail-scheduled/_shared/subito_acquisition.ts";
import {
  classifyFullSearchItems, fetchWholeSubitoSearch, fullSearchSeller, subitoSellerFilter, supabaseFullSearchDeps,
  SUBITO_FULL_MAX_PAGES_PER_SEARCH, SUBITO_FULL_MAX_SINGLE_NOTIFICATIONS
} from "../nmre-gmail-scheduled/_shared/subito_full_search.ts";
import { subitoSavedSearchDigest, SUBITO_REASON_TEXT } from "../nmre-gmail-scheduled/_shared/subito.ts";
import { sellerClassificationDetails } from "../nmre-gmail-scheduled/_shared/parser.ts";
import type { PageFetch } from "./dry_run.ts";
import type { ReadOnlyDb } from "./readonly.ts";

export type FullSearchDryRunItem = {
  id: string; url: string; titolo: string | null; prezzo: number | null; comune: string | null;
  decisione: "creerebbe_scheda" | "gia_nelle_opportunita" | "gia_in_archivio";
  tipo_venditore: string | null; motivo_venditore: string | null; possibili_duplicati: number;
};

export type FullSearchDryRunReport = {
  success: boolean; dry_run: true; modalita: "intera_ricerca"; esito: string; messaggio: string;
  ricerca: null | { chiave: string | null; nome: string | null; url: string | null; filtro_venditore: string; filtro_prova: string };
  lettura: null | { esito: string; motivo: string; motivo_testo: string; pagine_lette: number; pagine_dichiarate: number | null;
    annunci_dichiarati: number | null; annunci_letti: number; richieste: Array<{ pagina: number; http: number | null; url_finale: string | null }> };
  notifiche_previste: null | { singole: number; riepilogative: number; raggruppate: boolean };
  annunci: FullSearchDryRunItem[];
  riepilogo: Record<string, number>;
};

const emptySummary = () => ({ creerebbe_scheda: 0, gia_nelle_opportunita: 0, gia_in_archivio: 0, privati: 0, da_verificare: 0, professionali: 0, possibili_duplicati: 0 });

function failure(esito: string, messaggio: string): FullSearchDryRunReport {
  return { success: false, dry_run: true, modalita: "intera_ricerca", esito, messaggio, ricerca: null, lettura: null, notifiche_previste: null, annunci: [], riepilogo: emptySummary() };
}

export async function subitoFullSearchDryRun(input: {
  message: any; db: ReadOnlyDb; owner: string; fetchPage: PageFetch; sleep?: (ms: number) => Promise<void>; maxPages?: number;
}): Promise<FullSearchDryRunReport> {
  const email = emailFromGmailMessage(input.message);
  const digest = subitoSavedSearchDigest(email);
  if (!digest) return failure("non_ricerca_salvata", "L'email selezionata non è un'email Subito di ricerca salvata: nessuna elaborazione.");
  const filter = subitoSellerFilter(digest.searchUrl);
  const ricerca = { chiave: digest.searchKey, nome: digest.searchLabel, url: digest.searchUrl, filtro_venditore: filter.status, filtro_prova: filter.evidence };
  const requests: Array<{ pagina: number; http: number | null; url_finale: string | null }> = [];
  const fetchPage: PageFetch = async (url) => {
    const page = Number(new URL(url).searchParams.get("o") || "1");
    try {
      const response = await input.fetchPage(url);
      requests.push({ pagina: page, http: response.status, url_finale: response.finalUrl });
      return response;
    } catch (error) {
      requests.push({ pagina: page, http: null, url_finale: null });
      throw error;
    }
  };
  const base = supabaseSubitoDeps(input.db, input.owner, fetchPage);
  const deps = supabaseFullSearchDeps(input.db, input.owner, base, input.sleep);
  const fetched = await fetchWholeSubitoSearch(digest, deps, { maxPages: input.maxPages ?? SUBITO_FULL_MAX_PAGES_PER_SEARCH });
  const lettura = {
    esito: fetched.status, motivo: fetched.reason, motivo_testo: SUBITO_REASON_TEXT[fetched.reason] || fetched.reason,
    pagine_lette: fetched.pagesRead, pagine_dichiarate: fetched.totalPages, annunci_dichiarati: fetched.totalDeclared,
    annunci_letti: fetched.items.length, richieste: requests
  };
  if (fetched.status === "errore") {
    return { ...failure("ricerca_non_disponibile", lettura.motivo_testo), ricerca, lettura };
  }
  let classified;
  try {
    classified = await classifyFullSearchItems(fetched.items, deps);
  } catch (error) {
    return { ...failure("confronto_non_riuscito", "Lettura del database non riuscita: nessun annuncio classificato (" +
      (error instanceof Error ? error.message.slice(0, 160) : "errore") + ")."), ricerca, lettura };
  }
  const summary = emptySummary();
  const annunci: FullSearchDryRunItem[] = classified.map(entry => {
    const item = entry.item;
    const seller = entry.kind === "nuovo" ? fullSearchSeller(item, sellerClassificationDetails) : null;
    const decisione: FullSearchDryRunItem["decisione"] = entry.kind === "nuovo" ? "creerebbe_scheda"
      : entry.kind === "gia_in_opportunita" ? "gia_nelle_opportunita" : "gia_in_archivio";
    summary[decisione]++;
    if (seller) {
      if (seller.classification === "Privato") summary.privati++; else summary.da_verificare++;
      if (item.advertiserCompany === true) summary.professionali++;
    }
    const duplicates = entry.kind === "nuovo" ? entry.possibleDuplicates.length : 0;
    if (duplicates) summary.possibili_duplicati++;
    return { id: item.id, url: item.url, titolo: item.title, prezzo: item.price, comune: item.location, decisione,
      tipo_venditore: seller?.classification ?? null, motivo_venditore: seller?.evidence ?? null, possibili_duplicati: duplicates };
  });
  const grouped = summary.creerebbe_scheda > SUBITO_FULL_MAX_SINGLE_NOTIFICATIONS;
  return {
    success: true, dry_run: true, modalita: "intera_ricerca",
    esito: fetched.status === "completa" ? "ricerca_letta_completa" : "ricerca_letta_in_parte",
    messaggio: lettura.motivo_testo, ricerca, lettura,
    notifiche_previste: { singole: grouped ? 0 : summary.creerebbe_scheda, riepilogative: grouped ? 1 : 0, raggruppate: grouped },
    annunci, riepilogo: summary
  };
}

/** Rapporto leggibile (testo semplice), senza corpo dell'email né token. */
export function fullSearchReportText(report: FullSearchDryRunReport): string {
  const lines = ["PROVA SENZA SCRITTURE · Intera ricerca salvata Subito", "Esito: " + report.esito + " — " + report.messaggio];
  if (report.ricerca) lines.push("", "Ricerca: " + (report.ricerca.nome || report.ricerca.chiave || "n/d"),
    "  Filtro sugli inserzionisti: " + report.ricerca.filtro_venditore + " (" + report.ricerca.filtro_prova + ")");
  if (report.lettura) {
    const l = report.lettura;
    lines.push("", "Lettura: " + l.esito + " · pagine " + l.pagine_lette + "/" + (l.pagine_dichiarate ?? "n/d") + " · annunci letti " + l.annunci_letti
      + " su " + (l.annunci_dichiarati ?? "n/d") + " dichiarati");
    for (const r of l.richieste) lines.push("  pagina " + r.pagina + " · HTTP " + (r.http ?? "errore di rete"));
  }
  const s = report.riepilogo;
  lines.push("", "Riepilogo: schede che verrebbero create " + s.creerebbe_scheda + " (privati " + s.privati + ", da verificare " + s.da_verificare
    + ", professionali " + s.professionali + ", possibili duplicati " + s.possibili_duplicati + ") · già nelle Opportunità " + s.gia_nelle_opportunita
    + " · già in Archivio " + s.gia_in_archivio);
  if (report.notifiche_previste) lines.push("Notifiche previste all'attivazione: " + (report.notifiche_previste.raggruppate
    ? "1 notifica riepilogativa (schede create senza notifica singola)" : report.notifiche_previste.singole + " notifiche singole"));
  lines.push("Nessuna scrittura eseguita: nessuna scheda creata o modificata, nessun registro, cursore Gmail non letto né modificato, nessuna notifica.");
  return lines.join("\n");
}
