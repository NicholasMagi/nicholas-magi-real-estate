// Garanzie degli involucri di sola lettura: database, Gmail e token.
// deno-lint-ignore-file no-explicit-any
import { fakeSupabase } from "../nmre-gmail-scheduled/fake_supabase.ts";
import { allowedGmailUrl, READ_RPC_STABLE_MIGRATION, READ_RPCS, readOnlyDb, readOnlyGmail, WriteAttemptError } from "./readonly.ts";
import { accessTokenInMemory, readTokenRow } from "./gmail_auth.ts";

function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + " — ottenuto " + JSON.stringify(actual) + ", atteso " + JSON.stringify(expected));
  }
}
function throwsWrite(fn: () => unknown, label: string) {
  try { fn(); } catch (error) {
    if (error instanceof WriteAttemptError) return;
    throw new Error(label + ": errore inatteso " + String(error));
  }
  throw new Error(label + ": la scrittura non è stata bloccata");
}

Deno.test("database: insert, update, upsert, delete e metodi sconosciuti bloccati, anche dopo select()", () => {
  const fake = fakeSupabase({ annunci_candidati: [{ owner_id: "o", dedup_key: "k", stato: "da_verificare" }] });
  const db = readOnlyDb(fake.client) as any;
  for (const method of ["insert", "update", "upsert", "delete"]) {
    throwsWrite(() => db.from("annunci_candidati")[method]({ stato: "scartato" }), "from()." + method);
    throwsWrite(() => db.from("annunci_candidati").select("id").eq("owner_id", "o")[method]({ stato: "scartato" }), "select()." + method);
  }
  throwsWrite(() => db.from("nmre_gmail_sync_state"), "tabella non ammessa");
  throwsWrite(() => db.from("annunci_candidati_notifiche"), "storico notifiche non ammesso");
  throwsWrite(() => db.rpc("nmre_save_gmail_tokens", {}), "rpc di salvataggio");
  throwsWrite(() => db.rpc("nmre_try_acquire_gmail_sync_lock", {}), "rpc del lock");
  eq(fake.state.writes, 0, "nessuna scrittura raggiunta dal database");
  eq(fake.tables.annunci_candidati[0].stato, "da_verificare", "riga invariata");
});

Deno.test("database: le letture funzionano e le RPC ammesse sono inviate in GET (sola lettura)", async () => {
  const fake = fakeSupabase({ annunci_candidati: [{ owner_id: "o", dedup_key: "subito:123456789", stato: "da_verificare" }] });
  const seen: any[] = [];
  const admin = { from: fake.client.from, rpc: (name: string, params: any, options: any) => { seen.push({ name, options }); return Promise.resolve({ data: [], error: null }); } };
  const db = readOnlyDb(admin);
  const { data } = await db.from("annunci_candidati").select("id,stato").eq("owner_id", "o").like("dedup_key", "subito:%").limit(1);
  eq(data?.length, 1, "lettura riuscita");
  await db.rpc("nmre_get_gmail_tokens");
  eq(seen, [{ name: "nmre_get_gmail_tokens", options: { get: true } }], "RPC in GET");
  eq(db.log.map(e => e.operation), ["select", "rpc_get"], "registro delle letture");
});

Deno.test("Gmail: ammessi solo profilo, elenco e lettura di un messaggio; nessuna modifica, cronologia o watch", () => {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/";
  for (const ok of ["profile", "messages?q=from%3Asubito.it&maxResults=10", "messages/19a1f0c2d3e4b5a6?format=full",
    "messages/19a1f0c2d3e4b5a6?format=metadata&metadataHeaders=From&metadataHeaders=Subject"]) eq(allowedGmailUrl(base + ok), true, "ammesso " + ok);
  for (const ko of ["messages/19a1f0c2d3e4b5a6/modify", "messages/19a1f0c2d3e4b5a6/trash", "messages/send", "history?startHistoryId=1",
    "watch", "stop", "labels", "messages/19a1f0c2d3e4b5a6/attachments/a1", "messages/19a1f0c2d3e4b5a6?format=raw",
    "drafts", "settings/filters"]) eq(allowedGmailUrl(base + ko), false, "rifiutato " + ko);
  eq(allowedGmailUrl("https://example.com/gmail/v1/users/me/profile"), false, "altro dominio");
});

Deno.test("Gmail: solo GET, elenco limitato a 10 risultati", async () => {
  const requests: string[] = [];
  const gmail = readOnlyGmail("t", (url, init) => { requests.push(init.method + " " + url); return Promise.resolve(Response.json({ messages: [] })); });
  await gmail.list("from:subito.it", 500);
  await gmail.profile();
  eq(requests.every(r => r.startsWith("GET ")), true, "solo GET");
  eq(/maxResults=10(&|$)/.test(requests[0]), true, "massimo 10");
});

Deno.test("token: valido → nessuna richiesta; scaduto → rinnovo solo in memoria, nessun salvataggio", async () => {
  const calls: string[] = [];
  const fetcher = (url: string, init: RequestInit) => { calls.push(String(init.method) + " " + url); return Promise.resolve(Response.json({ access_token: "nuovo", expires_in: 3600 })); };
  const now = Date.parse("2026-11-27T10:00:00Z");
  const valid = await accessTokenInMemory({ access_token: "a", refresh_token: "r" }, "2026-11-27T11:00:00Z", {}, fetcher, now);
  eq([valid.token, valid.refreshedInMemory, calls.length], ["a", false, 0], "token valido usato senza rete");
  const expired = await accessTokenInMemory({ access_token: "a", refresh_token: "r" }, "2026-11-27T09:00:00Z", { clientId: "c", clientSecret: "s" }, fetcher, now);
  eq([expired.token, expired.refreshedInMemory], ["nuovo", true], "token rinnovato in memoria");
  eq(calls, ["POST https://oauth2.googleapis.com/token"], "una sola richiesta, al servizio dei token Google");
});

// PostgREST simulato: le richieste GET verso funzioni VOLATILE sono rifiutate; le
// funzioni STABLE vengono eseguite (in una transazione READ ONLY).
function postgrestRpc(volatility: "v" | "s", calls: any[]) {
  return {
    from: () => { throw new Error("non usato"); },
    rpc(name: string, params: any, options: any = {}) {
      calls.push({ name, method: options.get ? "GET" : "POST", params });
      if (options.get && volatility !== "s") {
        return Promise.resolve({ data: null, error: { code: "PGRST", message: "GET non ammesso su una funzione VOLATILE" } });
      }
      return Promise.resolve({ data: [{ email: "nicholasmagirealestate@gmail.com", token_ciphertext: "v1.a.b", expires_at: "2026-11-27T11:00:00Z" }], error: null });
    }
  };
}

Deno.test("token: con la funzione ancora VOLATILE la prova si ferma, senza ripiego su POST", async () => {
  const calls: any[] = [];
  const result = await readTokenRow(readOnlyDb(postgrestRpc("v", calls)), "nicholasmagirealestate@gmail.com");
  eq(result.ok, false, "prova interrotta");
  if (!result.ok) eq(result.esito, "token_non_leggibili_in_sola_lettura", "esito esplicito");
  eq(calls.map(c => c.method), ["GET"], "una sola chiamata, in GET; nessuna chiamata POST");
});

Deno.test("token: con la funzione STABLE la lettura in GET riesce", async () => {
  const calls: any[] = [];
  const result = await readTokenRow(readOnlyDb(postgrestRpc("s", calls)), "nicholasmagirealestate@gmail.com");
  eq(result.ok, true, "lettura riuscita");
  eq(calls.map(c => c.method), ["GET"], "solo GET");
  const other = await readTokenRow(readOnlyDb(postgrestRpc("s", [])), "altra@example.com");
  eq(other.ok, false, "casella diversa rifiutata");
});

Deno.test("contratto: ogni RPC ammessa in GET ha una migrazione che la rende STABLE, con rollback", () => {
  const root = new URL("../../", import.meta.url);
  for (const name of READ_RPCS) {
    const file = READ_RPC_STABLE_MIGRATION[name];
    const locations = ["migrations_pending/", "migrations/"].map(dir => new URL(dir + file, root));
    const found = locations.find(url => { try { Deno.statSync(url); return true; } catch { return false; } });
    if (!found) throw new Error("migrazione STABLE mancante per " + name + ": " + file);
    const sql = Deno.readTextFileSync(found).toLowerCase();
    eq(sql.includes("alter function public." + name + "() stable"), true, "la migrazione rende STABLE " + name);
    eq(sql.includes("raise exception"), true, "la migrazione si ferma se il corpo non è sicuro");
    const rollback = new URL("rollback/" + file.replace(/\.sql$/, ".rollback.sql"), root);
    eq(Deno.readTextFileSync(rollback).toLowerCase().includes("alter function public." + name + "() volatile"), true, "rollback presente per " + name);
  }
});
