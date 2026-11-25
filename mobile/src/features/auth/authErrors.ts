export function toFriendlyAuthError(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error !== null && typeof error === "object" && "message" in error &&
            typeof error.message === "string"
          ? error.message
          : "";
  const message = rawMessage.toLowerCase();

  if (message.includes("invalid login credentials") || message.includes("invalid_credentials")) {
    return "Email o password non corrette.";
  }
  if (message.includes("email not confirmed") || message.includes("email_not_confirmed")) {
    return "L'indirizzo email non risulta ancora confermato. Verifichi la casella di posta.";
  }
  if (
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("over_request_rate_limit") ||
    message.includes("over_email_send_rate_limit")
  ) {
    return "Sono stati effettuati troppi tentativi. Attenda qualche minuto e riprovi.";
  }
  if (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("timeout")
  ) {
    return "Non riesco a raggiungere il servizio. Controlli la connessione e riprovi.";
  }
  return "Accesso non riuscito. Verifichi i dati e riprovi.";
}
