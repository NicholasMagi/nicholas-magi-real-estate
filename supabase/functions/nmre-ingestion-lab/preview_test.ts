import { parsePublicListingPreview } from "./_shared/preview.ts";

Deno.test("public listing preview extracts structured real-estate data without classifying the seller", () => {
  const html = \`<script type="application/ld+json">
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
  </script>\`;
  const items = parsePublicListingPreview(html, "https://example.test/ricerca");
  if (items.length !== 2) throw new Error("Expected two JSON-LD candidates");
  if (items[0].municipality !== "Castelfidardo") throw new Error("Expected Castelfidardo municipality");
  if (items[0].territory !== "Ancona") throw new Error("Expected Ancona territory");
  if (items[0].price !== "145000") throw new Error("Expected offer price");
  if (items[0].url !== "https://example.test/annuncio/123") throw new Error("Expected absolute listing URL");
  if (items.some(item => item.seller !== "Da verificare" || item.importable !== false)) {
    throw new Error("Preview must never infer a private seller or be importable");
  }
  if (items[1].territory !== "Fuori zona") throw new Error("Unknown municipality must not be silently treated as target");
});

Deno.test("public listing preview ignores malformed JSON-LD and ordinary scripts", () => {
  const html = \`<script type="application/ld+json">{bad json}</script><script>window.__DATA__ = {}</script>\`;
  const items = parsePublicListingPreview(html, "https://example.test");
  if (items.length !== 0) throw new Error("Expected no candidates");
});
