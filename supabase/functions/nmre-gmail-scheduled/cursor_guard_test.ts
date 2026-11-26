// Garanzie strutturali di index.ts sull'avanzamento del cursore Gmail e sulle notifiche.
// Il ciclo completo (Gmail, blocco, cursore) non è eseguibile senza rete: questo test
// legge il sorgente reale e fallisce se le garanzie vengono rimosse. Richiede --allow-read.
const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
const handlerStart = source.indexOf("export default");
const handler = source.slice(handlerStart);
const loopStart = handler.indexOf("for (const row of rows)");
const cursorCalls = [...handler.matchAll(/await saveSyncCursor\(/g)].map(match => match.index!);

Deno.test("il cursore Gmail viene salvato una sola volta, dopo il ciclo dei candidati", () => {
  assert(loopStart > 0, "ciclo dei candidati non trovato");
  assert(cursorCalls.length === 1, "atteso un solo salvataggio del cursore, trovati " + cursorCalls.length);
  const lastWrite = Math.max(handler.lastIndexOf("applyNotificationToExistingCandidate("), handler.lastIndexOf("guardedCandidateUpdate("));
  assert(cursorCalls[0] > lastWrite, "il cursore deve essere salvato dopo tutte le scritture protette");
});

Deno.test("nessun errore del ciclo dei candidati viene ignorato prima del salvataggio del cursore", () => {
  const between = handler.slice(loopStart, cursorCalls[0]);
  assert(!/\bcatch\b/.test(between), "un catch tra il ciclo e il salvataggio del cursore potrebbe ignorare un conflitto e far avanzare il cursore");
});

Deno.test("il ramo di errore non salva il cursore", () => {
  const catchStart = handler.lastIndexOf("} catch (error) {");
  const finallyStart = handler.indexOf("} finally {", catchStart);
  assert(catchStart > cursorCalls[0], "ramo di errore non trovato dopo il salvataggio del cursore");
  const errorBranch = handler.slice(catchStart, finallyStart > 0 ? finallyStart : undefined);
  assert(!/saveSyncCursor\(/.test(errorBranch), "il ramo di errore non deve salvare il cursore");
});

Deno.test("le notifiche si registrano senza duplicati (owner_id + source_email_id)", () => {
  const upsert = handler.indexOf('.from("annunci_candidati_notifiche")\n          .upsert(');
  assert(upsert > 0, "registrazione della notifica con upsert non trovata");
  const options = handler.slice(upsert, upsert + 1200);
  assert(/onConflict: "owner_id,source_email_id"/.test(options), "la notifica deve usare onConflict owner_id,source_email_id");
});
