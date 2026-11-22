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

Deno.test("esclude la conferma di una ricerca salvata su Immobiliare.it", () => {
  const candidate = parseListingEmail({
    payload: {
      headers: [
        { name: "Subject", value: "La tua ricerca è stata salvata: Case in vendita" },
        { name: "From", value: '"Immobiliare.it" <noreply@immobiliare.it>' },
      ],
      mimeType: "text/plain",
      body: {
        data: encodeBase64Url(
          "Immobiliare.it Ricerca salvata. Ciao Nicholas, la tua ricerca è stata salvata e riceverai una email ogni volta che ci sono nuovi annunci."
        ),
      },
    },
  });
  assertEquals(candidate.likelyRealEstate, false, "conferma ricerca esclusa");
  assertEquals(
    candidate.warnings.some((warning) => warning.includes("esclusa dalla coda")),
    true,
    "avviso esplicito di esclusione"
  );
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
  assertEquals(makeCandidate("145.500,50 €").prezzo, 145500.5, "precisione dei centesimi");
  assertEquals(makeCandidate("145,000 €").prezzo, 145000, "virgola come separatore migliaia");
});

Deno.test("analizza una notifica Immobiliare.it con immobile all'asta", () => {
  const plain = [
    "Ciao Nicholas,",
    "1 nuovo annuncio per la tua ricerca Case in vendita",
    "appartamento all'asta via A. Bravi, 23, Recanati",
    "Centro",
    "Da € 4.612,5",
    "20 m² | 1 locale | 1 bagno",
    "VEDI DETTAGLI",
    "AVVIA RICERCA",
  ].join("\n");

  const html = '<html><body><a href="https://www.immobiliare.it/annunci/134982491/?utm_campaign=detail&amp;utm_source=alert_istantaneo&amp;utm_medium=email&amp;utm_content=20261122">VEDI DETTAGLI</a><a href="https://www.immobiliare.it/ricerca/">AVVIA RICERCA</a></body></html>';

  const candidate = parseListingEmail({
    id: "auction-alert-1",
    payload: {
      headers: [
        { name: "Subject", value: "1 nuovo annuncio per la tua ricerca Case in vendita" },
        { name: "From", value: '"Immobiliare.it" <noreply@immobiliare.it>' },
      ],
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: encodeBase64Url(plain) } },
        { mimeType: "text/html", body: { data: encodeBase64Url(html) } },
      ],
    },
  });

  assertEquals(candidate.likelyRealEstate, true, "notifica nuova riconosciuta");
  assertEquals(candidate.titolo, "ASTA — appartamento all'asta via A. Bravi, 23, Recanati", "titolo specifico e categoria asta");
  assertEquals(candidate.comune, "Recanati", "comune ricavato dall'indirizzo");
  assertEquals(candidate.prezzo, 4612.5, "prezzo d'asta con decimale");
  assertEquals(candidate.emailSubject, "1 nuovo annuncio per la tua ricerca Case in vendita", "oggetto originale della notifica conservato");
  assertEquals(candidate.warnings.some((warning) => warning.includes("importo 'Da'")), true, "prezzo di partenza segnalato");
  assertEquals(candidate.url, "https://www.immobiliare.it/annunci/134982491/?utm_campaign=detail&utm_source=alert_istantaneo&utm_medium=email&utm_content=20261122", "link reale VEDI DETTAGLI prioritario");
  assertEquals(candidate.deduplicationKey, "url:https://www.immobiliare.it/annunci/134982491", "deduplicazione indipendente dai parametri di tracciamento");
  assertEquals(candidate.tipo_venditore, "Da verificare", "asta non confusa con tipologia venditore");
  assertEquals(candidate.warnings.some((warning) => warning.includes("Asta giudiziaria")), true, "avviso specifico asta");
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
