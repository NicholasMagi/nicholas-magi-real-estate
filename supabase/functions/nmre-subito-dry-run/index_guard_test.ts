// Controlli strutturali sul codice della prova: nessun percorso di scrittura esiste.
const dir = new URL("./", import.meta.url);
const read = (name: string) => Deno.readTextFileSync(new URL(name, dir));
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const FILES = ["index.ts", "dry_run.ts", "readonly.ts", "gmail_auth.ts", "full_search_dry_run.ts"];

function check(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("nessuna operazione di scrittura sul database nel codice della prova", () => {
  for (const file of FILES) {
    const code = strip(read(file));
    check(!/\.(insert|update|upsert|delete)\s*\(/.test(code), file + ": operazione di scrittura presente");
    check(!/nmre_save_|nmre_try_acquire|nmre_release|nmre_get_gmail_sync_state|nmre_notifications|annunci_candidati_notifiche/.test(code),
      file + ": RPC o tabella di scrittura, lock, cursore o notifiche citata nel codice");
    check(!/saveCandidateRow|guardedCandidateUpdate|processRowsIsolated|subitoRowsForEmails|subitoFullSearchRows|saveFullSearchLogs|nmre_subito_ricerche_sync|keptForReviewPatch/.test(code),
      file + ": funzione di salvataggio di produzione importata");
  }
});

Deno.test("il client amministrativo è usato solo attraverso readOnlyDb", () => {
  const code = strip(read("index.ts"));
  const uses = code.match(/ctx\.supabaseAdmin/g) || [];
  check(uses.length === 1 && /readOnlyDb\(ctx\.supabaseAdmin/.test(code), "ctx.supabaseAdmin fuori da readOnlyDb");
  check(!/ctx\.supabase\b(?!Admin)/.test(code), "client utente usato direttamente");
  check(!/\.rpc\(\s*["'](?!nmre_get_gmail_tokens)/.test(strip(FILES.map(read).join("\n"))), "RPC diversa da nmre_get_gmail_tokens");
});

Deno.test("Gmail solo tramite readOnlyGmail: nessuna cronologia, watch o modifica", () => {
  const code = strip(read("index.ts") + read("dry_run.ts") + read("full_search_dry_run.ts"));
  check(!/gmail\.googleapis\.com/.test(code), "URL Gmail scritto fuori dall'involucro di sola lettura");
  check(!/history|\/watch|\/modify|\/trash|labelIds\s*:/.test(code.replace(/historyId/g, "")), "cronologia, watch o modifica delle etichette");
});

Deno.test("accesso riservato alla sessione del titolare, verifica JWT della piattaforma attiva", () => {
  const code = strip(read("index.ts"));
  check(/withSupabase\(\{\s*auth:\s*"user"\s*\}/.test(code), "auth diverso da user");
  check(/ctx\.userClaims\?\.id\s*!==\s*owner/.test(code), "manca il controllo NMRE_ALLOWED_USER_ID");
  const config = Deno.readTextFileSync(new URL("../../config.toml", import.meta.url));
  check(!/nmre-subito-dry-run/.test(config), "la prova non deve disattivare la verifica JWT in config.toml");
});

Deno.test("log senza corpo dell'email né token", () => {
  const code = strip(read("index.ts"));
  const logs = code.match(/console\.(log|error|info|warn)\([^;]*\);/g) || [];
  check(logs.length === 1, "un solo punto di log");
  check(/esito: report\.esito, annunci: report\.annunci\.length, riepilogo: report\.riepilogo/.test(logs[0] ?? ""), "il log contiene solo esito e conteggi");
});
