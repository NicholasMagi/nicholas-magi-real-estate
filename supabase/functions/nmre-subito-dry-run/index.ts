// nmre-subito-dry-run · Prova SENZA SCRITTURE di una singola email Subito di ricerca salvata.
//
// Garanzie (verificate anche dai test strutturali in index_guard_test.ts):
//  - accesso al database solo tramite readOnlyDb(): select su annunci_candidati e annunci,
//    RPC nmre_get_gmail_tokens in GET (transazione READ ONLY di PostgREST; richiede che la
//    funzione sia STABLE, migrazione 20261126200000 in supabase/migrations_pending/). Se la
//    chiamata in GET è rifiutata la prova si ferma: nessun ripiego su POST. Nessun insert/
//    update/upsert/delete, nessun lock, nessuna RPC di salvataggio;
//  - Gmail solo in lettura (profilo, elenco limitato a 10, un messaggio): nessuna lettura o
//    scrittura del cursore, nessuna cronologia, nessun watch, nessuna modifica di etichette;
//  - token di accesso rinnovato solo in memoria, mai salvato;
//  - una sola lettura della pagina dei risultati Subito, senza aggirare CAPTCHA o blocchi;
//  - nessuna notifica push; nei log solo l'esito e i conteggi (né corpo dell'email né token).
// Accesso: solo la sessione del titolare (JWT utente con id = NMRE_ALLOWED_USER_ID); la
// verifica JWT della piattaforma resta attiva (nessuna voce in supabase/config.toml).
import { withSupabase } from "npm:@supabase/server@^1";
import { readOnlyDb, readOnlyGmail } from "./readonly.ts";
import type { ReadLog } from "./readonly.ts";
import { accessTokenInMemory, decryptTokens, readTokenRow } from "./gmail_auth.ts";
import { failureReport, reportText, selectEmail, subitoDryRun, validateRequest } from "./dry_run.ts";
import type { DryRunReport } from "./dry_run.ts";
import { fullSearchReportText, subitoFullSearchDryRun } from "./full_search_dry_run.ts";
import type { FullSearchDryRunReport } from "./full_search_dry_run.ts";

const ACCOUNT = "nicholasmagirealestate@gmail.com";

// Pagina pubblica dei risultati Subito: stessa richiesta GET di nmre-gmail-scheduled
// (nessun User-Agent contraffatto, nessun tentativo di aggirare verifiche anti-robot).
async function fetchSubitoPage(url: string): Promise<{ status: number; finalUrl: string; html: string }> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "it-IT,it;q=0.9" },
    signal: AbortSignal.timeout(12000)
  });
  const html = (await response.text()).slice(0, 3_000_000);
  return { status: response.status, finalUrl: response.url || url, html };
}

function respond(report: DryRunReport | FullSearchDryRunReport, guarantees: Record<string, unknown>, status = 200) {
  // Log: solo esito e conteggi.
  console.log("nmre-subito-dry-run", JSON.stringify({ esito: report.esito, annunci: report.annunci.length, riepilogo: report.riepilogo }));
  const text = "modalita" in report ? fullSearchReportText(report) : reportText(report);
  return Response.json({ ...report, garanzie: guarantees, rapporto: text }, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Metodo non consentito" }, { status: 405 });
    const owner = Deno.env.get("NMRE_ALLOWED_USER_ID");
    if (!owner || ctx.userClaims?.id !== owner) return Response.json({ error: "Non autorizzato" }, { status: 403 });

    const readLog: ReadLog = [];
    const gmailCalls: string[] = [];
    let pageReads = 0;
    let refreshedInMemory = false;
    const guarantees = () => ({
      scritture_database: 0,
      letture_database: readLog.length,
      rpc_in_sola_lettura: [...new Set(readLog.filter(entry => entry.rpc).map(entry => entry.rpc))],
      chiamate_gmail: gmailCalls,
      pagine_subito_lette: pageReads,
      token_rinnovato_solo_in_memoria: refreshedInMemory,
      cursore_gmail: "non letto né modificato",
      notifiche_push: "nessuna"
    });

    try {
      let body: unknown = null;
      try { body = await req.json(); } catch { body = null; }
      const validation = validateRequest(body);
      if (!validation.ok) return respond(failureReport("richiesta_non_valida", validation.reason), guarantees(), 400);

      const encryptionSecret = Deno.env.get("INTEGRATION_TOKEN_ENCRYPTION_KEY");
      if (!encryptionSecret) throw new Error("Configurazione server incompleta");
      const db = readOnlyDb(ctx.supabaseAdmin, readLog);

      const tokenRow = await readTokenRow(db, ACCOUNT);
      if (!tokenRow.ok) return respond(failureReport(tokenRow.esito, tokenRow.messaggio), guarantees(), 503);
      const tokens = await decryptTokens(tokenRow.row.token_ciphertext, encryptionSecret);
      const access = await accessTokenInMemory(tokens, tokenRow.row.expires_at,
        { clientId: Deno.env.get("GOOGLE_CLIENT_ID"), clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET") }, fetch);
      refreshedInMemory = access.refreshedInMemory;

      const gmail = readOnlyGmail(access.token, (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }), gmailCalls);
      const profile = await gmail.profile();
      if (String(profile?.emailAddress || "").toLowerCase() !== ACCOUNT) throw new Error("La casella Gmail autorizzata non corrisponde");

      const selection = await selectEmail(gmail, validation.request);
      if (!selection.ok) return respond(failureReport("email_non_individuata", selection.reason, selection.candidates), guarantees());

      if (validation.request.modalita === "intera_ricerca") {
        // Tutte le pagine della ricerca (limite di produzione), con la stessa pausa tra le pagine.
        const full = await subitoFullSearchDryRun({
          message: selection.message, db, owner,
          fetchPage: (url) => { pageReads++; return fetchSubitoPage(url); },
          sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
        });
        return respond(full, guarantees());
      }
      const report = await subitoDryRun({
        message: selection.message, db, owner,
        fetchPage: (url) => { pageReads++; return fetchSubitoPage(url); },
        nowIso: new Date().toISOString()
      });
      return respond({ ...report, candidati_email: selection.candidates }, guarantees());
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "Errore sconosciuto";
      return respond(failureReport("errore", message), guarantees(), 500);
    }
  })
};
