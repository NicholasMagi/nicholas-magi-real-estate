import {
  buildDeduplicationKey,
  extractGmailMessageText,
  parseListingEmail,
} from "./listing-email-parser.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(message + ": expected " + String(expected) + ", got " + String(actual));
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

Deno.test("estrae testo da una parte Gmail text/plain", () => {
  const body = "Appartamento in vendita. Prezzo: 145.000 €";
  const text = extractGmailMessageText({
    payload: { mimeType: "text/plain", body: { data: encodeBase64Url(body) } },
  });
  assertEquals(text, body, "testo MIME");
});

Deno.test("usa HTML solo quando manca text/plain", () => {
  const html = '<html><body><h1>Casa in vendita</h1><p>Osimo</p><a href="https://example.com/immobile/55">Guarda immobile</a></body></html>';
  const text = extractGmailMessageText({
    payload: { mimeType: "text/html", body: { data: encodeBase64Url(html) } },
  });
  assertEquals(text.includes("Casa in vendita"), true, "titolo HTML");
  assertEquals(text.includes("Osimo"), true, "comune HTML");
  assertEquals(text.includes("https://example.com/immobile/55"), true, "href HTML");
});

Deno.test("estrae campi prudentemente e lascia il venditore da verificare", () => {
  const body = "Comune: Osimo\nPrezzo: 145.000 €\nhttps://example.com/annuncio/123";
  const candidate = parseListingEmail({
    id: "message-1",
    internalDate: "1790000000000",
    payload: {
      headers: [
        { name: "Subject", value: "Appartamento con terrazzo" },
        { name: "From", value: "Portale <avvisi@example.com>" },
      ],
      mimeType: "text/plain",
      body: { data: encodeBase64Url(body) },
    },
  });

  assertEquals(candidate.titolo, "Appartamento con terrazzo", "titolo");
  assertEquals(candidate.comune, "Osimo", "comune");
  assertEquals(candidate.prezzo, 145000, "prezzo");
  assertEquals(candidate.url, "https://example.com/annuncio/123", "URL");
  assertEquals(candidate.contatto, null, "il mittente della notifica non è un contatto venditore");
  assertEquals(candidate.notificationSender, "avvisi@example.com", "mittente della notifica");
  assertEquals(candidate.tipo_venditore, "Da verificare", "venditore prudente");
  assertEquals(candidate.reviewStatus, "da_verificare", "stato revisione");
});


Deno.test("esclude email che non sembrano notifiche immobiliari", () => {
  const candidate = parseListingEmail({
    payload: {
      headers: [
        { name: "Subject", value: "Promemoria appuntamento" },
        { name: "From", value: "Mail <mail@example.com>" },
      ],
      mimeType: "text/plain",
      body: { data: encodeBase64Url("Ci vediamo domani alle 10.") },
    },
  });
  assertEquals(candidate.likelyRealEstate, false, "email generica esclusa");
});

Deno.test("riconosce una notifica immobiliare", () => {
  const candidate = parseListingEmail({
    payload: {
      headers: [
        { name: "Subject", value: "Nuovo appartamento in vendita" },
        { name: "From", value: "Portale <mail@example.com>" },
      ],
      mimeType: "text/plain",
      body: { data: encodeBase64Url("Scopri il nuovo immobile.") },
    },
  });
  assertEquals(candidate.likelyRealEstate, true, "notifica immobiliare riconosciuta");
});

Deno.test("riconosce prezzi italiani con separatori diversi", () => {
  const makeCandidate = (price: string) => parseListingEmail({
    payload: {
      headers: [
        { name: "Subject", value: "Immobile in vendita" },
        { name: "From", value: "Avvisi <mail@example.com>" },
      ],
      mimeType: "text/plain",
      body: { data: encodeBase64Url("Prezzo: " + price) },
    },
  });

  assertEquals(makeCandidate("145.000 €").prezzo, 145000, "migliaia con punto");
  assertEquals(makeCandidate("145000 €").prezzo, 145000, "senza separatore");
  assertEquals(makeCandidate("145.000,00 €").prezzo, 145000, "migliaia e decimali");
  assertEquals(makeCandidate("145.500,50 €").prezzo, 145501, "arrotondamento al singolo euro");
  assertEquals(makeCandidate("145,000 €").prezzo, 145000, "virgola come separatore migliaia");
});

Deno.test("la deduplicazione ignora i parametri di tracciamento", () => {
  const first = buildDeduplicationKey({
    urls: ["https://example.com/casa/1?utm_source=mail"],
    sender: "alerts@example.com",
    subject: "Casa",
  });
  const second = buildDeduplicationKey({
    urls: ["https://example.com/casa/1"],
    sender: "alerts@example.com",
    subject: "Casa",
  });
  assertEquals(first, second, "chiave duplicati");
});
