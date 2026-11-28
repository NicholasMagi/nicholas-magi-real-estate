import { parsePublicListingPreview, parseSubitoPreview } from "./_shared/preview.ts";

Deno.test("public listing preview extracts structured real-estate data without classifying the seller", () => {
  const html = `<script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Apartment",
          "name": "Appartamento luminoso",
          "description": "Due camere e terrazzo",
          "url": "/annuncio/123",
          "address": { "@type": "PostalAddress", "addressLocality": "Castelfidardo" },
          "offers": { "@type": "Offer", "price": "145000", "priceCurrency": "EUR" }
        },
        {
          "@type": "House",
          "name": "Casa da verificare",
          "address": { "@type": "PostalAddress", "addressLocality": "Località non riconosciuta" }
        }
      ]
    }
  </script>`;
  const items = parsePublicListingPreview(html, "https://example.test/ricerca", new Set(["castelfidardo"]));
  if (items.length !== 2) throw new Error("Expected two JSON-LD candidates");
  if (items[0].municipality !== "Castelfidardo") throw new Error("Expected Castelfidardo municipality");
  if (items[0].territory !== "Ancona") throw new Error("Expected Ancona territory");
  if (items[0].within_45_min !== true) throw new Error("Expected configured 45-minute area match");
  if (items[1].within_45_min !== null) throw new Error("Unknown town must remain for manual territory review");
  if (items[0].price !== "145000") throw new Error("Expected offer price");
  if (items[0].url !== "https://example.test/annuncio/123") throw new Error("Expected absolute listing URL");
  if (items.some(item => item.seller !== "Da verificare" || item.importable !== false)) {
    throw new Error("Preview must never infer a private seller or be importable");
  }
  if (items[1].territory !== "Da verificare") throw new Error("Unknown municipality must not be silently treated as target");
});

Deno.test("public listing preview ignores malformed JSON-LD and ordinary scripts", () => {
  const html = `<script type="application/ld+json">{bad json}</script><script>window.__DATA__ = {}</script>`;
  const items = parsePublicListingPreview(html, "https://example.test");
  if (items.length !== 0) throw new Error("Expected no candidates");
});


Deno.test("Subito adapter reuses the established result parser and never imports automatically", () => {
  const fixture = Deno.readTextFileSync(new URL("../nmre-gmail-scheduled/fixtures/subito_results_page.html", import.meta.url));
  const result = parseSubitoPreview(fixture, new Set(["ancona", "osimo"]));
  if (result.page_status !== "ok") throw new Error("Expected readable Subito results page");
  if (result.page_source !== "next_data") throw new Error("Expected Subito structured result data");
  if (result.items.length !== 8) throw new Error("Expected eight fixture listings");
  if (!result.items.every(item => item.importable === false)) throw new Error("Subito preview must not import automatically");
  if (!result.items.every(item => item.within_45_min === true)) throw new Error("Ancona listings should match configured test territory");
});
