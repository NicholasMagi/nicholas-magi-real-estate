// Aggiornamento protetto dei candidati da parte della sincronizzazione Gmail.
//
// La funzione rilegge il candidato, calcola la modifica dal valore appena letto e
// scrive solo se updated_at è ancora quello letto (controllo ottimistico). Se nel
// frattempo il frontend (o un'altra scrittura) ha modificato il record, nessun dato
// viene sovrascritto: il candidato viene riletto e la modifica ricalcolata, per un
// numero limitato di tentativi. Se il conflitto persiste viene sollevato
// CandidateWriteConflict: la sincronizzazione si interrompe senza far avanzare il
// cursore Gmail e l'email viene rielaborata al ciclo successivo (le operazioni sono
// idempotenti).

export const GUARDED_MAX_ATTEMPTS = 3;

export class CandidateWriteConflict extends Error {
  constructor(public candidateId: string, public attempts: number) {
    super("Conflitto ripetuto durante l'aggiornamento di un candidato: il cursore non avanza e l'email verrà rielaborata");
    this.name = "CandidateWriteConflict";
  }
}

// Interfaccia minima del client Supabase usata qui (consente i test senza rete).
// deno-lint-ignore no-explicit-any
export type GuardedClient = { from(table: string): any };

export type GuardedResult<T> =
  | { status: "updated"; attempts: number; current: T; patch: Record<string, unknown> }
  | { status: "skipped"; attempts: number; current: T }
  | { status: "missing"; attempts: number }
  | { status: "error"; attempts: number; error: { code?: string; message?: string } };

/**
 * build(current) restituisce la modifica da scrivere, calcolata dal valore appena
 * riletto, oppure null se non c'è nulla da scrivere. columns deve includere updated_at.
 */
export async function guardedCandidateUpdate<T extends { updated_at?: unknown }>(
  admin: GuardedClient,
  owner: string,
  candidateId: string,
  columns: string,
  build: (current: T) => Record<string, unknown> | null,
  maxAttempts = GUARDED_MAX_ATTEMPTS
): Promise<GuardedResult<T>> {
  if (!/(^|,)\s*updated_at\s*(,|$)/.test(columns)) throw new Error("guardedCandidateUpdate: columns deve includere updated_at");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data: current, error: readError } = await admin.from("annunci_candidati")
      .select(columns).eq("owner_id", owner).eq("id", candidateId).maybeSingle();
    if (readError) return { status: "error", attempts: attempt, error: readError };
    if (!current) return { status: "missing", attempts: attempt };
    const patch = build(current as T);
    if (!patch) return { status: "skipped", attempts: attempt, current: current as T };
    let query = admin.from("annunci_candidati").update(patch).eq("owner_id", owner).eq("id", candidateId);
    const readUpdatedAt = (current as T).updated_at;
    query = readUpdatedAt === null || readUpdatedAt === undefined
      ? query.is("updated_at", null)
      : query.eq("updated_at", readUpdatedAt);
    const { data: written, error: writeError } = await query.select("id");
    if (writeError) return { status: "error", attempts: attempt, error: writeError };
    if (Array.isArray(written) && written.length === 1) return { status: "updated", attempts: attempt, current: current as T, patch };
    // Il record è cambiato tra lettura e scrittura: si rilegge e si ricalcola.
  }
  throw new CandidateWriteConflict(candidateId, maxAttempts);
}
