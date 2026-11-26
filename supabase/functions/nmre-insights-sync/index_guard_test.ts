// Garanzie strutturali di index.ts (il gestore HTTP non è eseguibile senza Supabase): il
// comportamento è verificato in sync_test.ts e provider_test.ts; qui si controlla che
// index.ts usi quelle funzioni nell'ordine sicuro. Richiede --allow-read.
const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
const at = (needle: string) => source.indexOf(needle);

Deno.test("autorizzazione commerciale e credenziali controllate prima di qualsiasi chiamata al provider", () => {
  const gate = at('if (!leadUseApproved) {');
  const creds = at('if (!settings.configured) {');
  const firstCall = at("collectInsightsListings(api");
  assert(gate > 0 && creds > gate && firstCall > creds, "ordine: autorizzazione, credenziali, ricerca");
  assert(at('Deno.env.get("INSIGHTS_LEAD_USE_APPROVED") === "true"') > 0, "il blocco si apre solo con il valore esatto 'true'");
  const getBranch = source.slice(at('if (req.method === "GET") {'), gate);
  assert(!/insightsRequest|collectInsightsListings|getInsightsToken/.test(getBranch), "la verifica dello stato non chiama il provider");
});

Deno.test("ricerca con dettaglio completo; errore della ricerca: nessuna scrittura", () => {
  assert(/"\/comparables\/" \+ endpoint/.test(source) && /"\/comparable\/id\/"/.test(source), "endpoint documentati");
  assert(!/searchByAttribute"/.test(source.replace(/fullSearchByAttribute/g, "")), "nessuna ricerca senza dettaglio");
  const failed = at('if (collection.status === "errore") {');
  const firstWrite = at('.from("annunci_candidati").insert(');
  assert(failed > 0 && firstWrite > failed, "uscita senza scritture prima di ogni inserimento");
});

Deno.test("Opportunità e Archivio letti per intero prima di inserire; lettura fallita: nessun inserimento", () => {
  const candidates = at('.from("annunci_candidati")\n        .select("id,url,url_originale,listing_key,dedup_key');
  const archive = at('.from("annunci")\n        .select("id,url,listing_key,deleted_at")');
  const plan = at("planInsightsWrites(collection");
  const insert = at('.from("annunci_candidati").insert(');
  assert(candidates > 0 && archive > candidates && plan > archive && insert > plan, "ordine: lettura candidati, Archivio, pianificazione, inserimento");
  assert(/Lettura dell'Archivio non riuscita: nessun annuncio importato/.test(source), "errore dell'Archivio interrompe l'importazione");
  assert(/for \(const row of plan\.inserts\)/.test(source), "si inserisce solo ciò che la pianificazione decide");
  assert(/planInsightsWrites\(collection, \{ candidates: existingCandidates, archive \}/.test(source), "la pianificazione riceve i candidati e l'Archivio letti");
});

Deno.test("aggiornamenti solo del venditore, su candidati in attesa e non verificati a mano", () => {
  const updates = [...source.matchAll(/\.update\(([\s\S]*?)\.select\("id"\)/g)].map(match => match[0]);
  assert(updates.length >= 2, "aggiornamenti trovati");
  for (const block of updates) {
    assert(/\.eq\("stato", "da_verificare"\)/.test(block) && /\.eq\("seller_manual_override", false\)/.test(block), "filtri di protezione su ogni aggiornamento");
    assert(!/titolo|prezzo|descrizione|stato:|dati_estratti|contatto/.test(block.replace(/\.eq\("stato"/g, "")), "nessun campo dell'annuncio o decisione modificati");
  }
  assert(!/contatto:\s*[^n]/.test(source), "il campo contatto non viene mai valorizzato");
});
