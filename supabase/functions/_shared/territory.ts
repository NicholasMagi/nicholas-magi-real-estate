/**
 * NMRE target acquisition territory: the 47 municipalities of Ancona and
 * the 55 municipalities of Macerata (ISTAT administrative boundaries, 2026).
 * Unknown locations are not classified as outside; callers should keep them
 * for manual territory review rather than silently discarding them.
 */
export const ANCONA_MUNICIPALITIES = new Set([
  "agugliano", "ancona", "arcevia", "barbara", "belvedere ostrense",
  "camerano", "camerata picena", "castelbellino", "castelfidardo",
  "castelleone di suasa", "castelplanio", "cerreto d'esi", "chiaravalle",
  "corinaldo", "cupramontana", "fabriano", "falconara marittima",
  "filottrano", "genga", "jesi", "loreto", "maiolati spontini", "mergo",
  "monsano", "monte roberto", "monte san vito", "montecarotto",
  "montemarciano", "morro d'alba", "numana", "offagna", "osimo", "ostra",
  "ostra vetere", "poggio san marcello", "polverigi", "rosora",
  "san marcello", "san paolo di jesi", "santa maria nuova", "sassoferrato",
  "senigallia", "serra de' conti", "serra san quirico", "sirolo",
  "staffolo", "trecastelli"
]);

export const MACERATA_MUNICIPALITIES = new Set([
  "apiro", "appignano", "belforte del chienti", "bolognola", "caldarola",
  "camerino", "camporotondo di fiastrone", "castelraimondo",
  "castelsantangelo sul nera", "cessapalombo", "cingoli",
  "civitanova marche", "colmurano", "corridonia", "esanatoglia", "fiastra",
  "fiuminata", "gagliole", "gualdo", "loro piceno", "macerata", "matelica",
  "mogliano", "monte cavallo", "monte san giusto", "monte san martino",
  "montecassiano", "montecosaro", "montefano", "montelupone", "morrovalle",
  "muccia", "penna san giovanni", "petriolo", "pieve torina", "pioraco",
  "poggio san vicino", "pollenza", "porto recanati", "potenza picena",
  "recanati", "ripe san ginesio", "san ginesio", "san severino marche",
  "sant'angelo in pontano", "sarnano", "sefro", "serrapetrona",
  "serravalle di chienti", "tolentino", "treia", "urbisaglia", "ussita",
  "valfornace", "visso"
]);

export const TARGET_MUNICIPALITIES = new Set([
  ...ANCONA_MUNICIPALITIES,
  ...MACERATA_MUNICIPALITIES
]);

export function normalizeMunicipality(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("it");
}

export function targetProvinceForMunicipality(value: unknown): "AN" | "MC" | null {
  const town = normalizeMunicipality(value);
  if (!town) return null;
  if (ANCONA_MUNICIPALITIES.has(town)) return "AN";
  if (MACERATA_MUNICIPALITIES.has(town)) return "MC";
  return null;
}

export function isTargetMunicipality(value: unknown): boolean {
  return targetProvinceForMunicipality(value) !== null;
}

export function territoryClassification(value: unknown): "Ancona" | "Macerata" | "Da verificare" | "Fuori zona" {
  const province = targetProvinceForMunicipality(value);
  if (province === "AN") return "Ancona";
  if (province === "MC") return "Macerata";
  return normalizeMunicipality(value) ? "Fuori zona" : "Da verificare";
}
