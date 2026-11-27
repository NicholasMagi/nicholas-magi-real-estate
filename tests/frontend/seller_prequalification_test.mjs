import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20261127100000_add_complete_seller_prequalification.sql", import.meta.url), "utf8");

test("la scheda espone i campi essenziali della prequalifica venditore", () => {
  for (const field of [
    "prezzo_minimo",
    "situazione_mutuo",
    "importo_mutuo_residuo",
    "comproprietari",
    "conformita_urbanistica",
    "conformita_catastale",
    "documenti_disponibili",
    "disponibilita_visite",
    "urgenza_vendita",
    "note"
  ]) {
    assert.match(html, new RegExp('data-prequal-field="' + field + '"'));
    assert.match(html, new RegExp(field + ':'));
  }
});

test("il salvataggio persiste la prequalifica come oggetto JSON", () => {
  assert.match(html, /prequalifica:\s*\{/);
  assert.match(html, /\.from\("annunci"\)\.update\(payload\)/);
});

test("la migration aggiunge una colonna JSONB compatibile con le schede esistenti", () => {
  assert.match(migration, /add column if not exists prequalifica jsonb not null default '\{\}'::jsonb/i);
  assert.match(migration, /jsonb_typeof\(prequalifica\) = 'object'/i);
});
