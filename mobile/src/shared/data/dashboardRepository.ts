import { supabase } from "@/shared/supabase/client";

export interface DashboardSummary {
  opportunities: number;
  toContact: number;
  dueCallbacks: number;
  mandates: number;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function countOrThrow(label: string, result: { count: number | null; error: { message: string } | null }): number {
  if (result.error) {
    throw new Error(`Non è stato possibile caricare il conteggio: ${label}.`);
  }
  return result.count ?? 0;
}

/**
 * Read-only summary for the signed-in owner.
 * RLS remains the authorization boundary; owner_id is an additional filter.
 */
export async function loadDashboardSummary(ownerId: string): Promise<DashboardSummary> {
  if (!ownerId) throw new Error("Sessione utente non disponibile.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");

  const today = localDateKey();
  const [opportunities, toContact, dueCallbacks, mandates] = await Promise.all([
    supabase
      .from("annunci_candidati")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("stato", "da_verificare")
      .is("annuncio_id", null),
    supabase
      .from("annunci")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("stato_contatto", "da_contattare"),
    supabase
      .from("annunci")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .in("stato_contatto", ["da_contattare", "primo_contatto", "interessato", "appuntamento"])
      .not("prossimo_contatto_il", "is", null)
      .lte("prossimo_contatto_il", today),
    supabase
      .from("annunci")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("stato_contatto", "incarico_acquisito")
  ]);

  return {
    opportunities: countOrThrow("opportunità da verificare", opportunities),
    toContact: countOrThrow("immobili da contattare", toContact),
    dueCallbacks: countOrThrow("richiami in scadenza", dueCallbacks),
    mandates: countOrThrow("incarichi acquisiti", mandates)
  };
}
