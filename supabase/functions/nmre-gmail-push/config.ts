// Configurazione di nmre-gmail-push: funzioni pure, senza rete né Deno.env (testabili).
//
// Tutti e tre i secret sono obbligatori. La subscription deve avere il formato di Google
// Cloud "projects/{project}/subscriptions/{subscription}" e viene confrontata ESATTAMENTE
// con il campo "subscription" della busta Pub/Sub (nessuna normalizzazione: spazi o
// differenze di maiuscole rendono la configurazione non valida o la richiesta rifiutata).
// Nei risultati compaiono solo i NOMI dei secret, mai i loro valori.

export const PUSH_SECRET_NAMES = [
  "GMAIL_PUBSUB_AUDIENCE",
  "GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL",
  "GMAIL_PUBSUB_SUBSCRIPTION"
] as const;
export type PushSecretName = (typeof PUSH_SECRET_NAMES)[number];

export type PushConfig = { audience: string; serviceAccount: string; subscription: string };

// ID progetto Google Cloud: 6-30 caratteri, minuscole, cifre e trattini, inizia con una
// lettera e non termina con un trattino. Nome della subscription: 3-255 caratteri,
// inizia con una lettera; lettere, cifre e - _ . ~ + %; non inizia con "goog".
const SUBSCRIPTION_FORMAT = /^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/subscriptions\/([A-Za-z][A-Za-z0-9\-_.~+%]{2,254})$/;

/** true se il valore ha il formato projects/{project}/subscriptions/{subscription}. */
export function isValidSubscriptionName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(SUBSCRIPTION_FORMAT);
  return !!match && !match[2].toLowerCase().startsWith("goog");
}

export type PushConfigResult =
  | { ok: true; config: PushConfig }
  | { ok: false; missing: PushSecretName[]; invalid: PushSecretName[] };

/** Legge i tre secret: tutti presenti e la subscription nel formato atteso, altrimenti errore. */
export function readPushConfig(get: (name: PushSecretName) => string | undefined | null): PushConfigResult {
  const values = Object.fromEntries(PUSH_SECRET_NAMES.map(name => [name, get(name) ?? ""])) as Record<PushSecretName, string>;
  const missing = PUSH_SECRET_NAMES.filter(name => values[name] === "");
  const invalid: PushSecretName[] = [];
  if (!missing.includes("GMAIL_PUBSUB_SUBSCRIPTION") && !isValidSubscriptionName(values.GMAIL_PUBSUB_SUBSCRIPTION)) {
    invalid.push("GMAIL_PUBSUB_SUBSCRIPTION");
  }
  if (missing.length || invalid.length) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: {
      audience: values.GMAIL_PUBSUB_AUDIENCE,
      serviceAccount: values.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL,
      subscription: values.GMAIL_PUBSUB_SUBSCRIPTION
    }
  };
}

/** Confronto esatto tra la subscription della busta Pub/Sub e quella configurata. */
export function subscriptionMatches(envelope: unknown, expected: string): boolean {
  const received = (envelope as { subscription?: unknown } | null)?.subscription;
  return typeof received === "string" && received === expected;
}
