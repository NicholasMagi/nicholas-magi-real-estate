// Accessi in SOLA LETTURA per la prova Subito senza scritture.
//
// Il database è raggiungibile solo attraverso readOnlyDb(): per ogni tabella ammessa
// espone esclusivamente select() e i filtri di lettura; insert, update, upsert, delete e
// qualsiasi altro metodo non esistono sull'oggetto restituito (la chiamata solleva un
// errore). Le RPC sono limitate a un elenco esplicito e vengono sempre inviate in GET
// ({ get: true }): PostgREST esegue le richieste GET in una transazione READ ONLY, quindi
// una scrittura fallirebbe invece di essere eseguita. PostgREST accetta in GET solo
// funzioni STABLE o IMMUTABLE: ogni RPC dell'elenco deve esserlo (per
// nmre_get_gmail_tokens: migrazione 20261126200000_gmail_tokens_rpc_stable, da applicare).
// Se la chiamata in GET viene rifiutata, l'errore arriva al chiamante: nessun ripiego su POST.
//
// Gmail è raggiungibile solo con richieste GET verso il profilo e i messaggi
// (elenco e singolo messaggio). Nessun endpoint di modifica, cronologia o watch.
// deno-lint-ignore-file no-explicit-any

export const READ_TABLES = ["annunci_candidati", "annunci"] as const;
export const READ_RPCS = ["nmre_get_gmail_tokens"] as const;
/** Migrazione che rende STABLE ciascuna RPC ammessa (verificata dai test). */
export const READ_RPC_STABLE_MIGRATION: Record<(typeof READ_RPCS)[number], string> = {
  nmre_get_gmail_tokens: "20261126200000_gmail_tokens_rpc_stable.sql"
};
const READ_METHODS = new Set([
  "eq", "neq", "is", "in", "like", "ilike", "gt", "gte", "lt", "lte", "not",
  "order", "limit", "range", "maybeSingle", "single", "abortSignal"
]);

export class WriteAttemptError extends Error {
  constructor(what: string) {
    super("Prova senza scritture: operazione non consentita (" + what + ")");
  }
}

export type ReadLog = { table?: string; rpc?: string; operation: string }[];

/** Avvolge un builder di lettura: solo filtri e risoluzione del risultato (then). */
function readBuilder(builder: any, label: string): any {
  return new Proxy({}, {
    get(_target, property: string | symbol) {
      if (property === "then") return builder.then.bind(builder);
      if (typeof property === "string" && READ_METHODS.has(property)) {
        return (...args: unknown[]) => readBuilder(builder[property](...args), label);
      }
      return () => { throw new WriteAttemptError(label + "." + String(property)); };
    }
  });
}

export function readOnlyDb(admin: any, log: ReadLog = []) {
  return {
    log,
    from(table: string): any {
      if (!(READ_TABLES as readonly string[]).includes(table)) throw new WriteAttemptError("tabella non ammessa: " + table);
      return new Proxy({}, {
        get(_target, property: string | symbol) {
          if (property === "select") {
            return (columns?: string, options?: Record<string, unknown>) => {
              log.push({ table, operation: "select" });
              return readBuilder(admin.from(table).select(columns, options), table);
            };
          }
          return () => { throw new WriteAttemptError(table + "." + String(property)); };
        }
      });
    },
    rpc(name: string, params: Record<string, unknown> = {}) {
      if (!(READ_RPCS as readonly string[]).includes(name)) throw new WriteAttemptError("rpc non ammessa: " + name);
      log.push({ rpc: name, operation: "rpc_get" });
      return admin.rpc(name, params, { get: true });
    }
  };
}
export type ReadOnlyDb = ReturnType<typeof readOnlyDb>;

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/";

/** URL Gmail ammessi: profilo, elenco messaggi, singolo messaggio (metadata o full). */
export function allowedGmailUrl(url: string): boolean {
  if (!url.startsWith(GMAIL)) return false;
  const rest = url.slice(GMAIL.length);
  return rest === "profile"
    || /^messages\?[^/]*$/.test(rest)
    || /^messages\/[0-9a-zA-Z]{8,32}\?format=(?:metadata|full)(?:&metadataHeaders=[A-Za-z-]+)*$/.test(rest);
}

export type GmailFetch = (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<Response>;

/** Lettore Gmail in sola lettura: solo GET verso gli URL ammessi, con contatore. */
export function readOnlyGmail(token: string, fetcher: GmailFetch, calls: string[] = []) {
  async function get(path: string): Promise<any> {
    const url = GMAIL + path;
    if (!allowedGmailUrl(url)) throw new WriteAttemptError("richiesta Gmail non ammessa");
    calls.push(path.replace(/\?.*$/, ""));
    const response = await fetcher(url, { method: "GET", headers: { Authorization: "Bearer " + token } });
    if (!response.ok) throw new Error("Lettura Gmail non riuscita (" + response.status + ")");
    return await response.json();
  }
  return {
    calls,
    profile: () => get("profile"),
    list: (query: string, maxResults: number) =>
      get("messages?" + new URLSearchParams({ q: query, maxResults: String(Math.min(Math.max(maxResults, 1), 10)) }).toString()),
    metadata: (id: string) => get("messages/" + encodeURIComponent(id) + "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date"),
    full: (id: string) => get("messages/" + encodeURIComponent(id) + "?format=full")
  };
}
export type ReadOnlyGmail = ReturnType<typeof readOnlyGmail>;
