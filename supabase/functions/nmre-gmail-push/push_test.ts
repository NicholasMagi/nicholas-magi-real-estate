// Test di nmre-gmail-push: configurazione obbligatoria, formato e confronto esatto della
// subscription, verifiche OIDC invariate, log senza dati sensibili. Nessuna rete: la
// verifica OIDC e l'avvio della sincronizzazione sono simulati.
// Uso: deno test --allow-read=. supabase/functions/nmre-gmail-push/push_test.ts
import { isValidSubscriptionName, readPushConfig, subscriptionMatches } from "./config.ts";
import type { PushSecretName } from "./config.ts";
import { handlePushRequest } from "./handler.ts";
import type { OidcPayload, PushDeps } from "./handler.ts";

function eq<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + " — ottenuto: " + JSON.stringify(actual) + ", atteso: " + JSON.stringify(expected));
  }
}

// Valori di prova (non sono quelli di produzione).
const SUBSCRIPTION = "projects/progetto-di-prova/subscriptions/nmre-push-prova";
const AUDIENCE = "https://esempio.supabase.co/functions/v1/nmre-gmail-push";
const SERVICE_ACCOUNT = "push-prova@progetto-di-prova.iam.gserviceaccount.com";
const TOKEN = "token-oidc-di-prova-segreto";
const GOOD_ENV: Record<PushSecretName, string> = {
  GMAIL_PUBSUB_AUDIENCE: AUDIENCE,
  GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL: SERVICE_ACCOUNT,
  GMAIL_PUBSUB_SUBSCRIPTION: SUBSCRIPTION
};

const b64url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function envelope(overrides: Record<string, unknown> = {}, notification: Record<string, unknown> = { emailAddress: "nicholasmagirealestate@gmail.com", historyId: "123456" }) {
  return { message: { data: b64url(JSON.stringify(notification)), messageId: "1" }, subscription: SUBSCRIPTION, ...overrides };
}
function request(body: unknown, options: { method?: string; token?: string | null } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token !== null) headers.Authorization = "Bearer " + (options.token ?? TOKEN);
  return new Request("https://esempio.supabase.co/functions/v1/nmre-gmail-push", {
    method: options.method ?? "POST", headers, body: options.method === "GET" ? undefined : JSON.stringify(body)
  });
}
function deps(options: { env?: Partial<Record<PushSecretName, string | undefined>>; payload?: OidcPayload; oidcError?: boolean } = {}) {
  const env = { ...GOOD_ENV, ...(options.env || {}) };
  const calls = { verify: [] as Array<{ token: string; audience: string }>, sync: [] as string[], logs: [] as string[] };
  const d: PushDeps = {
    env: name => env[name],
    verifyOidc: (token, audience) => {
      calls.verify.push({ token, audience });
      if (options.oidcError) return Promise.reject(new Error("signature verification failed"));
      return Promise.resolve(options.payload ?? { email: SERVICE_ACCOUNT, email_verified: true });
    },
    startSync: historyId => { calls.sync.push(historyId); return Promise.resolve({ data: { skipped: null }, error: null }); },
    log: (message, detail) => { calls.logs.push(message + (detail ? " | " + detail : "")); }
  };
  return { d, calls };
}
const noSecretsInLogs = (logs: string[]) => {
  const text = logs.join("\n");
  for (const value of [SUBSCRIPTION, AUDIENCE, SERVICE_ACCOUNT, TOKEN, "nicholasmagirealestate"]) {
    if (text.includes(value)) throw new Error("valore sensibile nei log: " + value);
  }
};

// ---------- Configurazione ----------

Deno.test("configurazione: tutti e tre i secret sono obbligatori", () => {
  eq(readPushConfig(name => GOOD_ENV[name]).ok, true, "configurazione completa");
  for (const name of Object.keys(GOOD_ENV) as PushSecretName[]) {
    for (const value of [undefined, ""]) {
      const result = readPushConfig(n => n === name ? value : GOOD_ENV[n]);
      eq(result.ok ? null : result.missing, [name], name + " " + JSON.stringify(value) + ": segnalato come mancante");
    }
  }
  const none = readPushConfig(() => undefined);
  eq(none.ok ? null : none.missing.length, 3, "nessun secret: tre mancanti");
});

Deno.test("configurazione: formato projects/{project}/subscriptions/{subscription}", () => {
  for (const valid of [
    SUBSCRIPTION,
    "projects/nmre-gmail-integration/subscriptions/nmre-gmail-push-sub",
    "projects/abcdef/subscriptions/abc",
    "projects/a23456789012345678901234567890/subscriptions/Sub_1.x~y+z%41"
  ]) eq(isValidSubscriptionName(valid), true, "valida: " + valid);
  for (const invalid of [
    "nmre-gmail-push-sub",                                          // solo il nome
    "projects/nmre-gmail-integration/topics/nmre-gmail-updates",     // topic, non subscription
    "projects/nmre-gmail-integration/subscriptions/",                // nome vuoto
    "projects//subscriptions/nmre-gmail-push-sub",                   // progetto vuoto
    " projects/nmre-gmail-integration/subscriptions/nmre-gmail-push-sub", // spazio iniziale
    "projects/nmre-gmail-integration/subscriptions/nmre-gmail-push-sub\n", // a capo finale
    "projects/NMRE-gmail-integration/subscriptions/nmre-gmail-push-sub",   // progetto con maiuscole
    "projects/abc/subscriptions/nmre-gmail-push-sub",                // progetto troppo corto
    "projects/nmre-gmail-integration-/subscriptions/nmre-push",      // progetto che termina con -
    "projects/nmre-gmail-integration/subscriptions/1push",           // nome che inizia con una cifra
    "projects/nmre-gmail-integration/subscriptions/goog-push",       // prefisso riservato
    "projects/nmre-gmail-integration/subscriptions/push/extra",      // segmento in più
    "https://pubsub.googleapis.com/v1/projects/p-1234/subscriptions/s-1" // URL
  ]) {
    eq(isValidSubscriptionName(invalid), false, "non valida: " + JSON.stringify(invalid));
    const result = readPushConfig(n => n === "GMAIL_PUBSUB_SUBSCRIPTION" ? invalid : GOOD_ENV[n]);
    eq(result.ok ? null : result.invalid, ["GMAIL_PUBSUB_SUBSCRIPTION"], "configurazione non valida: " + JSON.stringify(invalid));
  }
});

Deno.test("confronto esatto della subscription della busta", () => {
  eq(subscriptionMatches({ subscription: SUBSCRIPTION }, SUBSCRIPTION), true, "identica");
  for (const received of [undefined, null, "", 42, SUBSCRIPTION + " ", " " + SUBSCRIPTION, SUBSCRIPTION.toUpperCase(),
    "projects/progetto-di-prova/subscriptions/altra-subscription", "projects/altro-progetto/subscriptions/nmre-push-prova"]) {
    eq(subscriptionMatches({ subscription: received }, SUBSCRIPTION), false, "diversa: " + JSON.stringify(received));
  }
  eq(subscriptionMatches(null, SUBSCRIPTION), false, "busta assente");
});

// ---------- Richieste ----------

Deno.test("configurazione assente o non valida: HTTP 503, nessuna verifica né sincronizzazione, nessun valore nei log", async () => {
  for (const env of [
    { GMAIL_PUBSUB_SUBSCRIPTION: undefined },
    { GMAIL_PUBSUB_AUDIENCE: "" },
    { GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL: undefined },
    { GMAIL_PUBSUB_SUBSCRIPTION: "nmre-gmail-push-sub" }
  ]) {
    const { d, calls } = deps({ env });
    const response = await handlePushRequest(request(envelope()), d);
    eq(response.status, 503, "503 per " + JSON.stringify(env));
    eq(await response.json(), { error: "Configurazione Gmail Push incompleta" }, "messaggio generico");
    eq([calls.verify.length, calls.sync.length], [0, 0], "nessuna verifica OIDC e nessuna sincronizzazione");
    eq(calls.logs.length, 1, "un log");
    eq(/GMAIL_PUBSUB_/.test(calls.logs[0]), true, "il log nomina il secret");
    noSecretsInLogs(calls.logs);
    if (env.GMAIL_PUBSUB_SUBSCRIPTION === "nmre-gmail-push-sub" && calls.logs[0].includes("nmre-gmail-push-sub")) throw new Error("valore non valido nei log");
  }
});

Deno.test("subscription errata o assente nella busta: HTTP 403, nessuna sincronizzazione", async () => {
  for (const value of ["projects/progetto-di-prova/subscriptions/altra", SUBSCRIPTION + " ", undefined]) {
    const { d, calls } = deps();
    const body = envelope(value === undefined ? { subscription: undefined } : { subscription: value });
    const response = await handlePushRequest(request(body), d);
    eq(response.status, 403, "403 per " + JSON.stringify(value));
    eq(await response.json(), { error: "Subscription Pub/Sub non autorizzata" }, "messaggio");
    eq(calls.sync.length, 0, "nessuna sincronizzazione");
    eq(calls.verify.length, 1, "il token OIDC viene comunque verificato prima");
    noSecretsInLogs(calls.logs);
    if (value && calls.logs.join().includes("altra")) throw new Error("subscription ricevuta nei log");
  }
});

Deno.test("subscription corretta: sincronizzazione avviata con l'historyId", async () => {
  const { d, calls } = deps();
  const response = await handlePushRequest(request(envelope()), d);
  eq(response.status, 200, "200");
  eq(await response.json(), { success: true, historyId: "123456", skipped: null }, "risposta");
  eq(calls.sync, ["123456"], "sincronizzazione avviata una volta");
  eq(calls.verify, [{ token: TOKEN, audience: AUDIENCE }], "token verificato con l'audience configurata");
  eq(calls.logs, [], "nessun log");
});

Deno.test("verifiche OIDC invariate: metodo, token, firma, service account, email verificata", async () => {
  const cases: Array<[string, Parameters<typeof deps>[0], Parameters<typeof request>[1], number]> = [
    ["metodo GET", {}, { method: "GET" }, 405],
    ["token mancante", {}, { token: null }, 401],
    ["firma o audience non valide", { oidcError: true }, {}, 401],
    ["service account diverso", { payload: { email: "altro@progetto-di-prova.iam.gserviceaccount.com", email_verified: true } }, {}, 403],
    ["email non verificata", { payload: { email: SERVICE_ACCOUNT, email_verified: false } }, {}, 403],
    ["email verificata come stringa", { payload: { email: SERVICE_ACCOUNT, email_verified: "true" } }, {}, 200]
  ];
  for (const [label, depOptions, requestOptions, status] of cases) {
    const { d, calls } = deps(depOptions);
    const response = await handlePushRequest(request(envelope(), requestOptions), d);
    eq(response.status, status, label);
    if (status !== 200) eq(calls.sync.length, 0, label + ": nessuna sincronizzazione");
    noSecretsInLogs(calls.logs);
  }
});

Deno.test("messaggio: altra casella 204, historyId non valido 400, errore di avvio 503", async () => {
  const other = deps();
  eq((await handlePushRequest(request(envelope({}, { emailAddress: "altra@gmail.com", historyId: "1" })), other.d)).status, 204, "altra casella");
  eq(other.calls.sync.length, 0, "nessuna sincronizzazione per un'altra casella");
  const bad = deps();
  eq((await handlePushRequest(request(envelope({}, { emailAddress: "nicholasmagirealestate@gmail.com", historyId: "abc" })), bad.d)).status, 400, "historyId non valido");
  const failing = deps();
  failing.d.startSync = () => Promise.resolve({ data: null, error: { message: "Edge Function returned a non-2xx status code" } });
  eq((await handlePushRequest(request(envelope()), failing.d)).status, 503, "avvio non riuscito");
  noSecretsInLogs(failing.calls.logs);
});

Deno.test("index.ts: verifiche OIDC con chiavi Google, issuer Google, audience configurata e RS256", () => {
  const code = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  for (const [pattern, label] of [
    [/createRemoteJWKSet\(\s*new URL\("https:\/\/www\.googleapis\.com\/oauth2\/v3\/certs"\)/, "chiavi pubbliche Google"],
    [/issuer:\s*\["https:\/\/accounts\.google\.com",\s*"accounts\.google\.com"\]/, "issuer Google"],
    [/jwtVerify\(token, GOOGLE_JWKS, \{[\s\S]*?audience,/, "audience passata alla verifica"],
    [/algorithms:\s*\["RS256"\]/, "solo RS256"],
    [/withSupabase\(\{ auth: "none" \}/, "nessun JWT Supabase (token OIDC Google)"],
    [/handlePushRequest\(req,/, "logica in handler.ts"]
  ] as const) eq(pattern.test(code), true, label);
  const handler = Deno.readTextFileSync(new URL("./handler.ts", import.meta.url));
  eq(/console\./.test(handler), false, "handler.ts registra solo tramite deps.log");
  eq(/deps\.log\([^)]*(bearer|authorization|envelope|notification|audience|serviceAccount|subscription)\b/.test(handler), false,
    "nessun token, busta o valore di configurazione passato ai log");
});
