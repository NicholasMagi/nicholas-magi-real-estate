// Navigazione della mappa: Google Maps usa coordinate precise quando disponibili, altrimenti l'indirizzo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");

function grab(name) {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Funzione non trovata: " + name);
  let depth = 0;
  const bodyStart = html.indexOf("){", start) + 1;
  for (let index = bodyStart; index < html.length; index++) {
    if (html[index] === "{") depth++;
    else if (html[index] === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error("Funzione non chiusa: " + name);
}

const directions = new Function(grab("nmreGoogleMapsDirectionsUrl") + "\nreturn nmreGoogleMapsDirectionsUrl;")();
const coordinates = directions({ latitude: 43.4821, longitude: 13.5472, address: "Via Roma 10", municipality: "Osimo" });
assert.match(coordinates, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=43\.4821%2C13\.5472&travelmode=driving$/, "preferisce le coordinate salvate");
const address = directions({ latitude: null, longitude: null, address: "Via Roma 10", municipality: "Osimo" });
assert.match(address, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/, "usa l'indirizzo quando mancano coordinate");
assert.ok(address.includes("Via%20Roma%2010") && address.includes("Osimo") && address.includes("Italia"), "codifica indirizzo, comune e paese");
assert.equal(directions({ latitude: null, longitude: null, address: "", municipality: "" }), "", "non crea un link senza destinazione");
assert.ok(html.includes('class="nmre-map-directions"'), "il popup dei marker espone l'azione Google Maps");
assert.ok(html.includes("safe(directionsUrl)"), "il link navigatore viene sottoposto a escaping HTML");
console.log("Google Maps navigation tests passed.");
