// Database Supabase simulato in memoria per i test (nessuna rete). Supporta le query
// usate dalla sincronizzazione su annunci_candidati e annunci_candidati_notifiche, con i
// vincoli di unicità di produzione: (owner_id, dedup_key) e (owner_id, listing_key) sui
// candidati, (owner_id, source_email_id) sulle notifiche. Un aggiornamento senza
// updated_at riceve un nuovo updated_at, come farebbe il trigger del database.
// deno-lint-ignore-file no-explicit-any

export type FakeRow = Record<string, any>;
type Op = "select" | "insert" | "update" | "upsert";
export type FailRule = (table: string, op: Op, payload: any) => { code?: string; message: string } | null;

const UNIQUE: Record<string, string[][]> = {
  annunci_candidati: [["owner_id", "dedup_key"], ["owner_id", "listing_key"]],
  annunci_candidati_notifiche: [["owner_id", "source_email_id"]]
};

export function fakeSupabase(seed: Partial<Record<string, FakeRow[]>> = {}) {
  const tables: Record<string, FakeRow[]> = {
    annunci_candidati: structuredClone(seed.annunci_candidati || []),
    annunci_candidati_notifiche: structuredClone(seed.annunci_candidati_notifiche || [])
  };
  let sequence = 0;
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 26, 10, 0, 0) + (++tick) * 1000).toISOString();
  const state = { tables, fail: null as FailRule | null, rpcCalls: [] as Array<{ name: string; params: any }>, writes: 0 };
  for (const rows of Object.values(tables)) for (const row of rows) {
    row.id ??= "seed-" + (++sequence);
    row.created_at ??= stamp();
    row.updated_at ??= row.created_at;
  }

  const value = (row: FakeRow, column: string) => {
    if (column.includes("->>")) {
      const [base, key] = column.split("->>");
      const object = row[base];
      return object && typeof object === "object" ? (object[key] ?? null) : null;
    }
    return row[column] ?? null;
  };
  const conflict = (table: string, candidate: FakeRow, selfId?: string) =>
    (UNIQUE[table] || []).some(columns => columns.every(c => candidate[c] !== null && candidate[c] !== undefined)
      && tables[table].some(other => other.id !== selfId && columns.every(c => String(other[c]) === String(candidate[c]))));

  function from(table: string) {
    if (!tables[table]) tables[table] = [];
    const q = {
      op: "select" as Op, filters: [] as Array<(row: FakeRow) => boolean>, orders: [] as Array<[string, boolean]>,
      limit: null as number | null, single: false, payload: null as any, onConflict: "" as string
    };
    const builder: any = {
      select() { return builder; },
      eq(c: string, v: unknown) { q.filters.push(r => value(r, c) !== null && String(value(r, c)) === String(v)); return builder; },
      neq(c: string, v: unknown) { q.filters.push(r => String(value(r, c)) !== String(v)); return builder; },
      is(c: string, v: unknown) { q.filters.push(r => value(r, c) === v); return builder; },
      not(c: string, op: string, v: unknown) {
        if (op !== "is") throw new Error("fake: not(" + op + ") non supportato");
        q.filters.push(r => value(r, c) !== v); return builder;
      },
      lt(c: string, v: string) { q.filters.push(r => value(r, c) !== null && String(value(r, c)) < String(v)); return builder; },
      like(c: string, pattern: string) {
        const regex = new RegExp("^" + pattern.split("%").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
        q.filters.push(r => value(r, c) !== null && regex.test(String(value(r, c)))); return builder;
      },
      in(c: string, list: unknown[]) { const set = new Set(list.map(String)); q.filters.push(r => set.has(String(value(r, c)))); return builder; },
      order(c: string, options: { ascending?: boolean } = {}) { q.orders.push([c, options.ascending !== false]); return builder; },
      limit(n: number) { q.limit = n; return builder; },
      maybeSingle() { q.single = true; return builder; },
      insert(payload: any) { q.op = "insert"; q.payload = payload; return builder; },
      update(patch: any) { q.op = "update"; q.payload = patch; return builder; },
      upsert(payload: any, options: { onConflict?: string } = {}) { q.op = "upsert"; q.payload = payload; q.onConflict = options.onConflict || ""; return builder; },
      then(resolve: (value: unknown) => void, reject?: (error: unknown) => void) {
        try { resolve(run()); } catch (error) { reject ? reject(error) : resolve({ data: null, error: { message: String(error) } }); }
      }
    };
    function run(): { data: any; error: any } {
      const injected = state.fail?.(table, q.op, q.payload);
      if (injected) return { data: null, error: injected };
      const rows = tables[table];
      if (q.op === "insert") {
        const record = { ...structuredClone(q.payload), id: "c-" + (++sequence), created_at: stamp() };
        record.updated_at = record.created_at;
        if (conflict(table, record)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        rows.push(record); state.writes++;
        return { data: q.single ? { id: record.id } : [{ id: record.id }], error: null };
      }
      if (q.op === "upsert") {
        const columns = q.onConflict.split(",").map(c => c.trim()).filter(Boolean);
        const existing = rows.find(r => columns.every(c => String(r[c]) === String(q.payload[c])));
        if (existing) Object.assign(existing, structuredClone(q.payload), { updated_at: stamp() });
        else rows.push({ ...structuredClone(q.payload), id: "n-" + (++sequence), created_at: stamp(), updated_at: stamp() });
        state.writes++;
        return { data: null, error: null };
      }
      const matching = rows.filter(r => q.filters.every(f => f(r)));
      if (q.op === "update") {
        for (const row of matching) {
          const next = { ...row, ...structuredClone(q.payload) };
          if (conflict(table, next, row.id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        for (const row of matching) {
          Object.assign(row, structuredClone(q.payload));
          if (!("updated_at" in q.payload)) row.updated_at = stamp();
          state.writes++;
        }
        return { data: matching.map(r => ({ id: r.id })), error: null };
      }
      let result = [...matching];
      for (const [column, ascending] of [...q.orders].reverse()) {
        result.sort((a, b) => {
          const x = value(a, column), y = value(b, column);
          if (x === y) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return (x < y ? -1 : 1) * (ascending ? 1 : -1);
        });
      }
      if (q.limit !== null) result = result.slice(0, q.limit);
      const data = structuredClone(result);
      return { data: q.single ? (data[0] ?? null) : data, error: null };
    }
    return builder;
  }

  const client = {
    from,
    rpc(name: string, params: any) {
      state.rpcCalls.push({ name, params });
      return Promise.resolve({ data: { archived: false }, error: null });
    }
  };
  return { client, state, tables };
}
