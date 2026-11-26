// Garanzie strutturali di index.ts sull'avanzamento del cursore Gmail e sulle notifiche.
// Il ciclo completo (Gmail, blocco, cursore) non è eseguibile senza rete: questo test
// legge il sorgente reale e fallisce se le garanzie vengono rimosse. Richiede --allow-read.
const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
// Salvataggio di una riga (spostato da index.ts, stesso codice usato dai test di comportamento).
const saveSource = await Deno.readTextFile(new URL("./_shared/save_candidate.ts", import.meta.url));
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
const handler = source.slice(source.indexOf("export default"));
const failuresStart = handler.indexOf("const rowFailures: RowFailure[] = [];");
const loopStart = handler.indexOf("processRowsIsolated(rows,");
const completionCheck = handler.indexOf("assertAllRowsSaved(rowFailures);");
const cursorCalls = [...handler.matchAll(/await saveSyncCursor\(/g)].map(match => match.index!);

Deno.test("le email vengono elaborate in isolamento e gli errori raccolti", () => {
  assert(failuresStart > 0, "raccolta degli errori delle email non trovata");
  assert(loopStart > failuresStart, "il ciclo dei candidati deve usare processRowsIsolated");
  assert(completionCheck > loopStart, "dopo il ciclo deve esserci assertAllRowsSaved(rowFailures)");
});

Deno.test("il cursore Gmail viene salvato una sola volta, dopo la verifica che tutte le email siano salvate", () => {
  assert(cursorCalls.length === 1, "atteso un solo salvataggio del cursore, trovati " + cursorCalls.length);
  assert(cursorCalls[0] > completionCheck, "il cursore deve essere salvato dopo assertAllRowsSaved");
  const lastWrite = Math.max(handler.lastIndexOf("saveCandidateRow("), handler.lastIndexOf("guardedCandidateUpdate("));
  assert(lastWrite > 0, "salvataggio delle righe non trovato");
  assert(cursorCalls[0] > lastWrite, "il cursore deve essere salvato dopo tutte le scritture protette");
  const rowsLoop = handler.slice(loopStart, completionCheck);
  assert(/saveCandidateRow\(ctx\.supabaseAdmin, owner, row/.test(rowsLoop), "ogni riga deve essere salvata con saveCandidateRow dentro processRowsIsolated");
});

Deno.test("le email Subito di ricerca salvata passano dal recupero e i loro errori bloccano il cursore", () => {
  const subito = handler.indexOf("subitoRowsForEmails(");
  const failures = handler.indexOf("rowFailures.push(...subitoCycle.failures);");
  assert(subito > failuresStart && subito < loopStart, "il recupero Subito deve precedere il salvataggio delle righe");
  assert(failures > subito && failures < completionCheck, "gli errori del recupero Subito devono entrare in rowFailures prima della verifica");
  assert(/rows: any\[\] = \[\.\.\.regularRows, \.\.\.subitoRows\]/.test(handler), "le righe Subito vengono salvate con le altre");
});

Deno.test("nessun errore viene ignorato tra la raccolta degli errori e il salvataggio del cursore", () => {
  const region = handler.slice(failuresStart, cursorCalls[0]);
  for (const match of region.matchAll(/\bcatch\b/g)) {
    const after = region.slice(match.index!, match.index! + 260);
    const before = region.slice(Math.max(0, match.index! - 400), match.index!);
    const recorded = /rowFailures\.push\(/.test(after);
    // Unica eccezione ammessa: il catch della lettura di un URL (portale non riconoscibile).
    const urlParsing = /new URL\(/.test(before) && after.startsWith("catch {");
    assert(recorded || urlParsing, "catch che non registra l'errore in rowFailures: " + after.slice(0, 80).replace(/\s+/g, " "));
  }
});

Deno.test("un errore dell'archiviazione automatica non interrompe il ciclo", () => {
  const archive = saveSource.indexOf('rpc("nmre_auto_archive_private_candidate"');
  assert(archive > 0, "archiviazione automatica non trovata");
  const after = saveSource.slice(archive, archive + 500);
  assert(!/if \(archiveError\) throw/.test(after), "l'errore di archiviazione non deve interrompere il ciclo");
  assert(/autoArchiveErrors\+\+/.test(after), "l'errore di archiviazione deve essere conteggiato");
});

Deno.test("la decisione sugli scartati precede la registrazione della notifica", () => {
  const decision = saveSource.indexOf("applyNotificationToExistingCandidate(admin");
  const upsert = saveSource.indexOf('.from("annunci_candidati_notifiche")\n    .upsert(');
  assert(decision > 0 && upsert > 0, "decisione o registrazione della notifica non trovate");
  assert(decision < upsert, "la decisione deve essere scritta prima della registrazione della notifica");
});

Deno.test("il ramo di errore non salva il cursore", () => {
  const catchStart = handler.lastIndexOf("} catch (error) {");
  const finallyStart = handler.indexOf("} finally {", catchStart);
  assert(catchStart > cursorCalls[0], "ramo di errore non trovato dopo il salvataggio del cursore");
  const errorBranch = handler.slice(catchStart, finallyStart > 0 ? finallyStart : undefined);
  assert(!/saveSyncCursor\(/.test(errorBranch), "il ramo di errore non deve salvare il cursore");
});

Deno.test("le notifiche si registrano senza duplicati (owner_id + source_email_id)", () => {
  const upsert = saveSource.indexOf('.from("annunci_candidati_notifiche")\n    .upsert(');
  assert(upsert > 0, "registrazione della notifica con upsert non trovata");
  assert(/onConflict: "owner_id,source_email_id"/.test(saveSource.slice(upsert, upsert + 1200)), "la notifica deve usare onConflict owner_id,source_email_id");
});

Deno.test("index.ts usa le funzioni condivise testate per leggere e smistare le email", () => {
  // Il comportamento è verificato sull'email reale in subito_real_test.ts; qui si controlla
  // che index.ts usi proprio quelle funzioni, senza copie locali.
  assert(/return emailFromGmailMessage\(await response\.json\(\)\);/.test(source), "readEmail deve usare emailFromGmailMessage");
  assert(/= classifyMailbox\(mailboxEmails\);/.test(handler), "lo smistamento deve usare classifyMailbox(mailboxEmails)");
  assert(/sellerForEmail\(String\(email\.id\), subitoDigestById,/.test(handler), "il venditore deve passare da sellerForEmail");
  assert(/repairEmailId\(candidate\.source_email_id\)/.test(handler), "la rielaborazione deve usare repairEmailId");
  assert(!/function (bodyParts|htmlParts|decode)\(/.test(source), "nessuna copia locale della lettura del messaggio");
  assert(!/propertyEmailDecision\(/.test(handler), "il filtro avvisi passa solo da classifyMailbox");
});
