import {
  MARCHE_MUNICIPALITIES,
  PROVINCES,
  canonicalMunicipalityName,
  getMunicipalityInfo,
  normalizeMunicipalityName,
} from "./territorio.js";

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ": expected " + String(expected) + ", got " + String(actual));
  }
}

Deno.test("repertorio completo dei 225 comuni marchigiani", () => {
  assertEquals(MARCHE_MUNICIPALITIES.length, 225, "totale comuni");
  for (const province of PROVINCES) {
    const count = MARCHE_MUNICIPALITIES.filter((item) => item.provinceCode === province.code).length;
    assertEquals(count, province.count, "numero comuni provincia " + province.code);
  }
});

Deno.test("riconosce anche i comuni piccoli delle Marche", () => {
  assertEquals(getMunicipalityInfo("Poggio San Marcello")?.provinceCode, "AN", "comune piccolo in provincia di Ancona");
  assertEquals(getMunicipalityInfo("Bolognola")?.provinceCode, "MC", "comune piccolo in provincia di Macerata");
  assertEquals(getMunicipalityInfo("Monte Rinaldo")?.provinceCode, "FM", "comune piccolo in provincia di Fermo");
  assertEquals(getMunicipalityInfo("Palmiano")?.provinceCode, "AP", "comune piccolo in provincia di Ascoli Piceno");
  assertEquals(getMunicipalityInfo("Frontino")?.provinceCode, "PU", "comune piccolo in provincia di Pesaro e Urbino");
});

Deno.test("normalizza accenti, apostrofi e sigle provinciali", () => {
  assertEquals(normalizeMunicipalityName("  SANT’ANGELO IN PONTANO (MC) "), "sant'angelo in pontano", "normalizzazione");
  assertEquals(getMunicipalityInfo("Sant'Angelo in Pontano (MC)")?.name, "Sant'Angelo in Pontano", "ricerca con sigla");
  assertEquals(getMunicipalityInfo("Castelfidardo AN")?.provinceCode, "AN", "ricerca con provincia finale");
});

Deno.test("riconosce abbreviazioni ricorrenti e lascia liberi i comuni fuori repertorio", () => {
  assertEquals(canonicalMunicipalityName("Camporotondo di F."), "Camporotondo di Fiastrone", "alias Camporotondo");
  assertEquals(canonicalMunicipalityName("San Benedetto del T."), "San Benedetto del Tronto", "alias San Benedetto");
  assertEquals(getMunicipalityInfo("Città non presente"), null, "comune esterno al repertorio non inventato");
  assertEquals(canonicalMunicipalityName("Città non presente"), "Città non presente", "testo manuale conservato");
});
