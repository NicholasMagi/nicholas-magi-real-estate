import {
  ANCONA_MUNICIPALITIES,
  MACERATA_MUNICIPALITIES,
  TARGET_MUNICIPALITIES,
  isTargetMunicipality,
  targetProvinceForMunicipality,
  territoryClassification
} from "./territory.ts";

Deno.test("Target territory contains exactly the 47 Ancona and 55 Macerata municipalities", () => {
  if (ANCONA_MUNICIPALITIES.size !== 47) throw new Error("Ancona municipality count mismatch");
  if (MACERATA_MUNICIPALITIES.size !== 55) throw new Error("Macerata municipality count mismatch");
  if (TARGET_MUNICIPALITIES.size !== 102) throw new Error("Combined municipality count mismatch");
});

Deno.test("Known target municipalities map to the correct province", () => {
  for (const town of ["Castelfidardo", "Ancona", "Jesi", "Senigallia", "Cupramontana"]) {
    if (targetProvinceForMunicipality(town) !== "AN") throw new Error("Expected AN: " + town);
  }
  for (const town of ["Macerata", "Civitanova Marche", "Camerino", "Recanati", "Tolentino"]) {
    if (targetProvinceForMunicipality(town) !== "MC") throw new Error("Expected MC: " + town);
  }
});

Deno.test("Nearby but out-of-province municipalities are excluded", () => {
  for (const town of ["Fermo", "Porto Sant'Elpidio", "Montegranaro", "Ascoli Piceno", "Pesaro", "Urbino"]) {
    if (isTargetMunicipality(town)) throw new Error("Outside municipality accepted: " + town);
  }
  if (territoryClassification("Fermo") !== "Fuori zona") throw new Error("Outside classification mismatch");
  if (territoryClassification("") !== "Da verificare") throw new Error("Unknown classification mismatch");
});

Deno.test("Normalization accepts accents and punctuation without fuzzy matches", () => {
  if (!isTargetMunicipality("Morro d’Alba")) throw new Error("Curly apostrophe normalization failed");
  if (isTargetMunicipality("Ancona centro")) throw new Error("Partial or embellished municipality must not match");
});
