// Le schede importate dal browser (source_email_id "subito-browser:<lotto>#subito-<id>") non sono
// email: non devono mai essere rilette o "riparate" dalla sincronizzazione Gmail, nemmeno se in
// futuro le versioni di estrazione o classificazione aumentano. Un tentativo di lettura di quel
// riferimento come messaggio Gmail fallirebbe e fermerebbe l'intera sincronizzazione.
// Uso: deno test --allow-read=. supabase/functions/nmre-gmail-scheduled/browser_import_guard_test.ts
import { isNonGmailSourceReference, isRepairEligible } from "./_shared/retention.ts";
import { repairEmailId } from "./_shared/mailbox.ts";

function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
}

Deno.test("schede importate dal browser: mai idonee alla rielaborazione, qualunque versione", () => {
  for (const versions of [
    { deduplication_version: 1, data_extraction_version: 6, seller_classification_version: 4 },
    { deduplication_version: 0, data_extraction_version: 1, seller_classification_version: 1 },
    {}
  ]) {
    eq(isRepairEligible({ source_email_id: "subito-browser:mabc123#subito-669796300", seller_manual_override: false, ...versions }), false,
      "non idonea con versioni " + JSON.stringify(versions));
  }
  eq(isNonGmailSourceReference("subito-browser:x#subito-1"), true, "riferimento del browser riconosciuto");
});

Deno.test("le email Gmail restano idonee come prima (nessuna regressione)", () => {
  eq(isRepairEligible({ source_email_id: "18c2f0a1b2c3d4e5", deduplication_version: 1, data_extraction_version: 1, seller_classification_version: 3 }), true, "email con estrazione vecchia");
  eq(isRepairEligible({ source_email_id: "18c2f0a1b2c3d4e5#subito-669796300", deduplication_version: 1, data_extraction_version: 1, seller_classification_version: 3 }), true, "annuncio di una ricerca salvata");
  eq(isRepairEligible({ source_email_id: "18c2f0a1b2c3d4e5", deduplication_version: 1, data_extraction_version: 6, seller_classification_version: 3 }), false, "email già aggiornata");
  eq(isRepairEligible({ source_email_id: "18c2f0a1b2c3d4e5", seller_manual_override: true, deduplication_version: 0 }), false, "classificazione manuale");
  eq(repairEmailId("18c2f0a1b2c3d4e5#subito-669796300"), "18c2f0a1b2c3d4e5", "email riepilogativa");
});

Deno.test("seconda protezione in index.ts: si rileggono solo identificativi con la forma di un ID Gmail", () => {
  const code = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  eq(/\.map\(\(candidate: any\) => repairEmailId\(candidate\.source_email_id\)\)\s*(?:\/\/[^\n]*\n\s*)*\.filter\(\(id: string\) => \/\^\[0-9A-Za-z\]\{6,64\}\$\/\.test\(id\)\)/.test(code), true, "filtro presente");
  const accepted = ["18c2f0a1b2c3d4e5", "subito-browser:mabc#subito-1".split("#")[0], ""].filter(id => /^[0-9A-Za-z]{6,64}$/.test(id));
  eq(accepted, ["18c2f0a1b2c3d4e5"], "riferimento del browser e vuoto esclusi");
});
