import type {
  NovaCandidate,
  NovaContext,
  NovaInteraction,
  NovaListing,
  NovaPriceObservation,
  NovaReply,
  NovaSuggestedAction
} from "./types";

export interface NovaPriority {
  score: number;
  label: "Alta" | "Media" | "Da qualificare";
  description: string;
  reasons: readonly string[];
}

export interface NovaCandidateQuality {
  score: number;
  missing: readonly string[];
  recommendedMissing: readonly string[];
  possibleDuplicate: boolean;
  pricePerSqm: number | null;
}

interface NovaAction {
  kind: "candidate" | "listing";
  id: string;
  title: string;
  municipality: string;
  tag: string;
  detail: string;
  nextStep: string;
  score: number;
}

const CORE_TERRITORY = new Set(["ancona", "osimo", "castelfidardo", "jesi"]);
const NEARBY_TERRITORY = new Set([
  "porto sant elpidio", "porto recanati", "porto san giorgio", "civitanova marche",
  "falconara marittima", "santa maria nuova", "maiolati spontini", "monte san vito",
  "monte urano", "monte roberto", "montecassiano", "morro d alba", "montemarciano",
  "loreto", "recanati", "camerano", "numana", "sirolo", "macerata", "fermo",
  "senigallia", "filottrano", "polverigi", "agugliano", "offagna", "chiaravalle",
  "ostra", "tolentino", "staffolo", "cupramontana", "monsano", "trecastelli",
  "corridonia", "montegranaro"
]);

const IGNORED_TITLE_WORDS = new Set([
  "appartamento", "immobile", "immobiliare", "casa", "vendita", "vendesi",
  "affitto", "nuovo", "nuova", "privato", "annuncio", "mq", "zona", "centro"
]);

export function normalizeNovaText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((dayStart(to).getTime() - dayStart(from).getTime()) / 86_400_000);
}

function formatCurrency(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "Prezzo non indicato";
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(value);
}

function isSpecificListingUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = decodeURIComponent(url.pathname).toLowerCase();
    if (path === "/" || /\/(?:search|ricerca|risultati|vendita|affitto|case-in-vendita|immobili-in-vendita)(?:\/|$)/.test(path)) return false;
    if (host === "immobiliare.it" || host.endsWith(".immobiliare.it")) {
      return /\/(?:annunci|immobile)\/[^/]*\d{5,}/i.test(path);
    }
    if (host === "idealista.it" || host.endsWith(".idealista.it")) {
      return /\/immobile\/\d{5,}/i.test(path);
    }
    return /\/(?:annuncio|annunci|immobile|immobili|property|listing|detail)\/[^/]+/i.test(path)
      || path.split("/").filter(Boolean).some(part => part.length >= 10 || /\d{6,}/.test(part));
  } catch {
    return false;
  }
}

function canonicalUrl(value: string | null): string | null {
  if (!isSpecificListingUrl(value) || !value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "").toLowerCase() || "/";
    return host + path;
  } catch {
    return null;
  }
}

function titleSimilarity(leftValue: string | null, rightValue: string | null): number {
  const tokens = (value: string | null): Set<string> => new Set(
    normalizeNovaText(value)
      .split(/\s+/)
      .filter(word => word.length > 2 && !IGNORED_TITLE_WORDS.has(word))
  );
  const left = tokens(leftValue);
  const right = tokens(rightValue);
  if (!left.size || !right.size) return 0;
  let common = 0;
  left.forEach(word => {
    if (right.has(word)) common += 1;
  });
  return common / (left.size + right.size - common);
}

function isLikelySameProperty(candidate: NovaCandidate, other: NovaCandidate | NovaListing): boolean {
  const cityA = normalizeNovaText(candidate.municipality);
  const cityB = normalizeNovaText(other.municipality);
  if (!cityA || cityA !== cityB) return false;
  const priceA = candidate.askingPrice ?? 0;
  const priceB = other.askingPrice ?? 0;
  if (priceA <= 0 || priceB <= 0) return false;
  const tolerance = Math.max(1_200, Math.min(priceA, priceB) * 0.012);
  if (Math.abs(priceA - priceB) > tolerance) return false;
  const otherCandidate = other as NovaCandidate;
  const typeA = normalizeNovaText(candidate.propertyType);
  const typeB = normalizeNovaText(otherCandidate.propertyType);
  if (typeA && typeB && typeA !== typeB) return false;
  const surfaceA = candidate.surfaceSqm ?? 0;
  const surfaceB = otherCandidate.surfaceSqm ?? 0;
  const surfaceClose = surfaceA > 0 && surfaceB > 0
    && Math.abs(surfaceA - surfaceB) <= Math.max(5, Math.min(surfaceA, surfaceB) * 0.04);
  const titleClose = titleSimilarity(candidate.title, other.title) >= 0.8;
  return (surfaceClose && !!typeA && !!typeB) || (titleClose && !!typeA && !!typeB);
}

function findDuplicate(
  candidate: NovaCandidate,
  candidates: readonly NovaCandidate[],
  listings: readonly NovaListing[]
): boolean {
  const url = canonicalUrl(candidate.listingUrl);
  for (const other of candidates) {
    if (other.id === candidate.id) continue;
    const otherUrl = canonicalUrl(other.listingUrl);
    if ((url && otherUrl && url === otherUrl) || isLikelySameProperty(candidate, other)) return true;
  }
  for (const other of listings) {
    if (isLikelySameProperty(candidate, other)) return true;
  }
  return false;
}

export function candidatePriority(candidate: NovaCandidate, now = new Date()): NovaPriority {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, label: string): void => {
    score += points;
    if (points > 0) reasons.push(label + " +" + points);
  };

  if (candidate.sellerClass === "Privato") add(25, "Privato riconosciuto");
  else if (candidate.sellerClass === "Da verificare") add(7, "Venditore da qualificare");

  const notificationDate = parseDate(candidate.notificationAt);
  const createdDate = parseDate(candidate.createdAt);
  const hasNotificationDate = notificationDate !== null;
  const timestamp = notificationDate ?? createdDate;
  if (timestamp) {
    const days = Math.max(0, daysBetween(timestamp, now));
    const points = hasNotificationDate
      ? (days <= 2 ? 20 : days <= 7 ? 16 : days <= 14 ? 11 : days <= 30 ? 5 : 0)
      : (days <= 2 ? 10 : days <= 7 ? 8 : days <= 14 ? 5 : days <= 30 ? 2 : 0);
    add(points, hasNotificationDate
      ? "Notifica email ricevuta (" + days + " gg fa)"
      : "Record acquisito (" + days + " gg fa)");
  } else {
    reasons.push("Data notifica non disponibile");
  }

  const municipality = normalizeNovaText(candidate.municipality);
  if (CORE_TERRITORY.has(municipality)) add(20, "Zona operativa principale");
  else if (NEARBY_TERRITORY.has(municipality)) add(10, "Territorio operativo esteso");
  else reasons.push(municipality ? "Fuori dal nucleo territoriale principale" : "Comune da verificare");

  if (candidate.hasDirectContact) add(15, "Contatto diretto inserito");
  else reasons.push("Contatto diretto assente");
  if (isSpecificListingUrl(candidate.listingUrl)) add(10, "Link specifico all'annuncio");
  else reasons.push(candidate.listingUrl ? "Link non verificato come scheda specifica" : "Link annuncio assente");
  add(candidate.askingPrice !== null && candidate.askingPrice > 0 ? 4 : 0, "Prezzo presente");
  add(candidate.surfaceSqm !== null && candidate.surfaceSqm > 0 ? 4 : 0, "Superficie presente");
  add(candidate.propertyType ? 2 : 0, "Tipologia presente");

  const reduction = candidate.priceDropPercent ?? 0;
  if (reduction > 0) {
    add(reduction >= 10 ? 22 : reduction >= 5 ? 16 : 10,
      "Ribasso prezzo segnalato (" + reduction.toLocaleString("it-IT") + "%)");
  }

  score = Math.min(100, score);
  const level = score >= 70 ? "Alta" : score >= 45 ? "Media" : "Da qualificare";
  const description = candidate.sellerClass === "Privato"
    ? (level === "Alta" ? "Privato da contattare per primo"
      : level === "Media" ? "Privato da completare" : "Completi i dati prima del contatto")
    : (level === "Alta" ? "Verifichi subito chi vende"
      : level === "Media" ? "Opportunità da qualificare" : "Venditore ancora da identificare");
  return { score, label: level, description, reasons };
}

export function candidateQuality(
  candidate: NovaCandidate,
  candidates: readonly NovaCandidate[],
  listings: readonly NovaListing[]
): NovaCandidateQuality {
  const specificLink = isSpecificListingUrl(candidate.listingUrl);
  const missing: string[] = [];
  const recommendedMissing: string[] = [];
  if (!candidate.municipality) missing.push("comune");
  if (!(candidate.askingPrice && candidate.askingPrice > 0)) missing.push("prezzo");
  if (!candidate.propertyType) missing.push("tipologia");
  if (!(candidate.surfaceSqm && candidate.surfaceSqm > 0)) missing.push("superficie");
  if (!(candidate.rooms && candidate.rooms > 0)) missing.push("locali");
  if (!candidate.notificationAt && !candidate.createdAt) missing.push("data notifica email");
  if (!candidate.hasDirectContact) recommendedMissing.push("recapito diretto da verificare");

  let score = 0;
  if (candidate.municipality) score += 15;
  if (candidate.askingPrice && candidate.askingPrice > 0) score += 15;
  if (candidate.propertyType) score += 10;
  if (candidate.surfaceSqm && candidate.surfaceSqm > 0) score += 15;
  if (candidate.rooms && candidate.rooms > 0) score += 5;
  if (specificLink) score += 15;
  if (candidate.notificationAt || candidate.createdAt) score += 10;
  if (candidate.sellerClass === "Privato" && (candidate.sellerConfidence ?? 0) >= 90) score += 10;
  if (candidate.hasDirectContact) score += 5;

  const pricePerSqm = candidate.askingPrice && candidate.surfaceSqm
    && candidate.askingPrice > 0 && candidate.surfaceSqm > 0
    ? Math.round(candidate.askingPrice / candidate.surfaceSqm)
    : null;
  return {
    score,
    missing,
    recommendedMissing,
    possibleDuplicate: findDuplicate(candidate, candidates, listings),
    pricePerSqm
  };
}

function latestPriceDrop(observations: readonly NovaPriceObservation[], now: Date): {
  observation: NovaPriceObservation;
  ageDays: number;
} | null {
  const drops = observations
    .filter(item => item.previousPrice !== null && item.listingPrice > 0
      && item.previousPrice > item.listingPrice
      && (item.priceDropPercent ?? 0) > 0)
    .map(item => ({ observation: item, date: parseDate(item.observedAt) }))
    .filter((row): row is { observation: NovaPriceObservation; date: Date } => row.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const last = drops[drops.length - 1];
  if (!last) return null;
  return { observation: last.observation, ageDays: daysBetween(last.date, now) };
}

function formatDate(value: string | null): string {
  const date = parseDate(value);
  return date ? date.toLocaleDateString("it-IT") : "Data non disponibile";
}

function makeAction(
  kind: "candidate" | "listing",
  id: string,
  title: string | null,
  municipality: string | null,
  tag: string,
  detail: string,
  nextStep: string,
  score: number
): NovaAction {
  return {
    kind,
    id,
    title: title || "Immobile senza titolo",
    municipality: municipality || "Comune non indicato",
    tag,
    detail,
    nextStep,
    score
  };
}

export function buildNovaActionPlan(
  context: NovaReadyContext,
  municipality: string | null = null,
  now = new Date()
): readonly NovaAction[] {
  const town = normalizeNovaText(municipality);
  const matchesTown = (value: string | null): boolean => !town || normalizeNovaText(value) === town;
  const actions = new Map<string, NovaAction>();
  const add = (action: NovaAction): void => {
    const key = action.kind + ":" + action.id;
    const previous = actions.get(key);
    if (!previous || action.score > previous.score) actions.set(key, action);
  };
  const interactionsByListing = new Map<string, NovaInteraction[]>();
  context.interactions.forEach(event => {
    if (!interactionsByListing.has(event.listingId)) interactionsByListing.set(event.listingId, []);
    interactionsByListing.get(event.listingId)?.push(event);
  });
  interactionsByListing.forEach(events => events.sort((a, b) =>
    (parseDate(b.createdAt)?.getTime() ?? 0) - (parseDate(a.createdAt)?.getTime() ?? 0)));

  context.listings.filter(item => matchesTown(item.municipality)
    && !["incarico_acquisito", "non_interessato"].includes(item.status)
    && item.otherAgencies !== "esclusiva").forEach(item => {
      const due = parseDate(item.nextContactDate);
      const gap = due ? daysBetween(dayStart(now), due) : null;
      const meta = [item.municipality, formatCurrency(item.askingPrice)].filter(Boolean).join(" · ");
      const title = item.title || "Proprietario";
      if (item.status === "appuntamento" && gap !== null) {
        if (gap < 0) add(makeAction("listing", item.id, title, item.municipality,
          "ESITO APPUNTAMENTO DA AGGIORNARE", meta, "Verificare com'è andato l'incontro e registrare l'esito.", 104 + Math.min(10, Math.abs(gap))));
        else if (gap <= 3) add(makeAction("listing", item.id, title, item.municipality,
          gap === 0 ? "APPUNTAMENTO OGGI" : "APPUNTAMENTO IN ARRIVO", meta,
          "Preparare l'incontro e confermare l'orario con il proprietario.", 100 - gap));
      } else if (gap !== null && gap <= 0) {
        add(makeAction("listing", item.id, title, item.municipality,
          gap < 0 ? "RICHIAMO IN RITARDO" : "RICHIAMO DA FARE OGGI",
          meta + (gap < 0 ? " · Scaduto da " + Math.abs(gap) + " giorni" : " · Scadenza oggi"),
          gap < 0 ? "Richiamare e aggiornare il prossimo passo concordato." : "Effettuare il richiamo e registrare l'esito.",
          110 + Math.min(12, Math.abs(gap))));
      }

      if (item.status === "interessato" && !item.nextContactDate) {
        add(makeAction("listing", item.id, title, item.municipality,
          "INTERESSE SENZA FOLLOW-UP", meta,
          "Contattare il proprietario e concordare una data per il prossimo aggiornamento.", 94));
      }

      const calls = (interactionsByListing.get(item.id) ?? [])
        .filter(event => event.kind === "telefonata" && event.outcomeCode)
        .slice(0, 2);
      if (calls.length === 2 && calls.every(event => event.outcomeCode === "nessuna_risposta")) {
        add(makeAction("listing", item.id, title, item.municipality,
          "DUE TENTATIVI SENZA RISPOSTA", meta,
          "Evitare chiamate ravvicinate: valutare un diverso orario o un canale appropriato.", 78));
      }

      const drop = latestPriceDrop(item.priceObservations, now);
      if (drop && drop.ageDays >= 0 && drop.ageDays <= 30) {
        const observation = drop.observation;
        add(makeAction("listing", item.id, title, item.municipality,
          "RIBASSO DOCUMENTATO", meta + " · " + formatCurrency(observation.previousPrice)
            + " → " + formatCurrency(observation.listingPrice),
          "Chiedere come procede la vendita dopo la modifica della richiesta, senza presumere disponibilità a incaricare un'agenzia.", 84));
      }

      if (["interessato", "primo_contatto"].includes(item.status) && !item.nextContactDate && item.lastContactAt) {
        const last = parseDate(item.lastContactAt);
        if (last && daysBetween(last, now) >= 7) {
          add(makeAction("listing", item.id, title, item.municipality,
            "CONTINUITÀ DA RECUPERARE", meta,
            "Riprendere la conversazione e verificare se la vendita è ancora attuale.", 82));
        }
      }

      const gaps: string[] = [];
      if (!item.hasDirectContact) gaps.push("recapito");
      if (!item.saleMotivation) gaps.push("motivazione");
      if (!item.saleTimeline) gaps.push("tempistiche");
      if (!item.otherAgencies || item.otherAgencies === "da_verificare") gaps.push("situazione agenzie");
      if (!item.priceNegotiable || item.priceNegotiable === "da_verificare") gaps.push("margine sul prezzo");
      if (gaps.length && item.status !== "interessato") {
        add(makeAction("listing", item.id, title, item.municipality,
          "SCHEDA PROPRIETARIO DA COMPLETARE", meta + " · " + gaps.length + " informazioni mancanti",
          "Completare durante il prossimo contatto: " + gaps.slice(0, 3).join(", ") + ".", 58 + Math.min(12, gaps.length * 2)));
      }
    });

  context.candidates.filter(item => matchesTown(item.municipality) && item.sellerClass !== "Agenzia")
    .forEach(item => {
      const priority = candidatePriority(item, now);
      const quality = candidateQuality(item, context.candidates, context.listings);
      const drop = latestPriceDrop(item.priceObservations, now);
      let score = (item.sellerClass === "Privato" ? 72 : 57) + Math.round(priority.score * 0.16);
      if (drop && drop.ageDays >= 0 && drop.ageDays <= 30) score += 10;
      if (quality.possibleDuplicate) score -= 14;
      if (!isSpecificListingUrl(item.listingUrl)) score -= 5;
      score = Math.max(35, Math.min(96, score));
      let next = item.sellerClass === "Privato"
        ? "Verificare che l'annuncio sia attivo e contattare il proprietario per qualificare motivazione e tempistiche."
        : "Verificare prima l'identità del venditore: non considerare questo annuncio un privato confermato.";
      if (!isSpecificListingUrl(item.listingUrl)) next = "Recuperare e verificare il link specifico dell'annuncio prima di procedere.";
      if (!item.hasDirectContact && item.sellerClass === "Privato") next = "Reperire il recapito su un canale consentito e verificare che l'annuncio sia attivo.";
      if (quality.possibleDuplicate) next = "Verificare il possibile duplicato nell'archivio prima di avviare un nuovo contatto.";
      if (drop && drop.ageDays >= 0 && drop.ageDays <= 30) next = "Verificare il ribasso documentato e chiedere come procede la vendita.";
      add(makeAction("candidate", item.id, item.title, item.municipality,
        item.sellerClass === "Privato" ? "PRIVATO RICONOSCIUTO" : "VENDITORE DA VERIFICARE",
        [item.municipality, formatCurrency(item.askingPrice),
          "priorità " + priority.score + "/100", "completezza " + quality.score + "/100"].filter(Boolean).join(" · "),
        next, score));
    });

  return [...actions.values()].sort((a, b) => b.score - a.score);
}

function unavailableDataMessage(context: NovaContext): string {
  if (context.status === "loading") return "Sto attendendo il collegamento ai dati NMRE. Non mostrerò risultati finché il caricamento non sarà completato.";
  if (context.status === "error") return "Non riesco a leggere i dati NMRE in questo momento. " + (context.message || "Riprovi quando il collegamento sarà disponibile.");
  return "NOVA è pronta nell'app, ma l'archivio NMRE non è ancora collegato a questa versione mobile. Non inventerò conteggi, proprietari o opportunità. La connessione sicura in sola lettura sarà attivata dopo il modulo di autenticazione.";
}

function helpText(): string {
  return "Può chiedermi, quando i dati NMRE saranno collegati:\n\n"
    + "• «Chi devo contattare per primo?»\n"
    + "• «Quali sono le mie priorità di oggi a Osimo?»\n"
    + "• «Mostrami le migliori opportunità»\n"
    + "• «Quali richiami sto trascurando?»\n"
    + "• «Mostrami le schede incomplete»\n"
    + "• «Quali immobili hanno avuto un ribasso?»\n"
    + "• «Quanti privati ho?»\n"
    + "• «Preparami una telefonata per un proprietario»\n\n"
    + "In questa fase NOVA usa regole verificabili: non genera risposte libere con un modello AI e non invia richieste a OpenAI.";
}

function genericCallScript(): string {
  return "Ecco una traccia da personalizzare.\n\n"
    + "«Buongiorno, sono un consulente di Ghergo Immobiliare. La contatto in merito al Suo annuncio. È ancora disponibile e sto parlando direttamente con il proprietario?\n\n"
    + "Vorrei capire qual è il motivo principale della vendita, in quali tempi vorrebbe concluderla e quali riscontri ha ricevuto finora.\n\n"
    + "Se lo ritiene interessante, possiamo fissare un breve incontro per esaminare l'immobile e confrontarci sul valore di mercato e sulla strategia di vendita. Quale giorno Le sarebbe più comodo?»\n\n"
    + "Prima del contatto verifichi che l'annuncio sia attivo e che il venditore sia classificato correttamente. Non anticipi valutazioni o condizioni non ancora verificate.";
}

function townFromMessage(message: string): string | null {
  const known = [
    "Castelfidardo", "Osimo", "Ancona", "Jesi", "Loreto", "Recanati", "Sirolo", "Numana",
    "Camerano", "Falconara Marittima", "Chiaravalle", "Senigallia", "Porto Recanati",
    "Civitanova Marche", "Macerata", "Fermo", "Montemarciano", "Monte San Vito",
    "Santa Maria Nuova", "Maiolati Spontini", "Monte Urano", "Montecassiano",
    "Morro d'Alba", "Filottrano", "Polverigi", "Agugliano", "Offagna", "Ostra",
    "Tolentino", "Staffolo", "Cupramontana", "Monsano", "Trecastelli", "Corridonia",
    "Montegranaro", "Porto Sant'Elpidio", "Porto San Giorgio"
  ];
  const normalized = " " + normalizeNovaText(message) + " ";
  return known.sort((a, b) => b.length - a.length)
    .find(town => normalized.includes(" " + normalizeNovaText(town) + " ")) ?? null;
}

function topOpportunityText(
  item: NovaCandidate,
  priority: NovaPriority,
  quality: NovaCandidateQuality,
  index: number
): string {
  const details = [item.municipality, item.propertyType,
    item.surfaceSqm ? item.surfaceSqm + " m²" : null].filter(Boolean).join(" · ");
  const seller = item.sellerClass === "Privato" ? "Privato riconosciuto" : "Venditore da verificare";
  const notes = ["completezza dati " + quality.score + "/100"];
  if (quality.possibleDuplicate) notes.push("possibile duplicato");
  if (quality.missing.length) notes.push("da completare: " + quality.missing.slice(0, 3).join(", "));
  return (index + 1) + ". " + (item.title || "Annuncio immobiliare")
    + "\n   " + (details || "Caratteristiche da completare")
    + "\n   " + seller + " · " + formatCurrency(item.askingPrice) + " · priorità " + priority.score + "/100"
    + "\n   Motivo: " + priority.reasons.slice(0, 2).join(" · ")
    + "\n   Dati: " + notes.join(" · ");
}

function actionPlanText(actions: readonly NovaAction[], town: string | null): string {
  if (!actions.length) return "Non ho individuato attività operative prioritarie"
    + (town ? " a " + town : "") + " nei dati attualmente caricati.";
  const urgent = actions.filter(row => row.score >= 100).length;
  const leads = actions.filter(row => row.kind === "candidate").length;
  return (town ? "PIANO D'AZIONE · " + town.toLocaleUpperCase("it") : "PIANO D'AZIONE · OGGI")
    + "\n" + actions.length + " azioni individuate · " + urgent + " urgenti · " + leads + " opportunità da qualificare.\n\n"
    + actions.slice(0, 6).map((row, index) =>
      (index + 1) + ". " + row.title
      + "\n   " + row.detail + " · " + row.tag
      + "\n   Prossima mossa: " + row.nextStep
    ).join("\n\n")
    + "\n\nL'ordine è un supporto operativo basato su scadenze, stato CRM, segnali documentati e qualità dei dati; non è una previsione di acquisizione.";
}

function buildActionsForReply(actions: readonly NovaAction[]): NovaSuggestedAction[] {
  return actions.slice(0, 6).map(row => ({
    kind: row.kind,
    id: row.id,
    label: row.kind === "candidate" ? "Apri opportunità" : "Apri scheda proprietario"
  }));
}

function respondWithData(message: string, context: NovaReadyContext): NovaReply {
  const normalized = normalizeNovaText(message);
  const town = townFromMessage(message);
  const actionPlan = buildNovaActionPlan(context, town);
  if (normalized.includes("chi devo contattare") || normalized.includes("chi contattare")
    || normalized.includes("priorit") || normalized.includes("piano d azione")
    || normalized.includes("cosa devo fare") || normalized.includes("da dove comincio")) {
    return { text: actionPlanText(actionPlan, town), actions: buildActionsForReply(actionPlan) };
  }

  if (normalized.includes("incomplet") || normalized.includes("dati mancanti") || normalized.includes("da completare")) {
    const rows: Array<{ kind: "candidate" | "listing"; id: string; title: string; town: string; gaps: string[] }> = [];
    context.listings.filter(item => !town || normalizeNovaText(item.municipality) === normalizeNovaText(town))
      .filter(item => !["incarico_acquisito", "non_interessato"].includes(item.status))
      .forEach(item => {
        const gaps: string[] = [];
        if (!item.hasDirectContact) gaps.push("recapito");
        if (!item.saleMotivation) gaps.push("motivazione vendita");
        if (!item.saleTimeline) gaps.push("tempistiche");
        if (!item.otherAgencies || item.otherAgencies === "da_verificare") gaps.push("altre agenzie");
        if (!item.priceNegotiable || item.priceNegotiable === "da_verificare") gaps.push("trattabilità prezzo");
        if (gaps.length) rows.push({ kind: "listing", id: item.id, title: item.title || "Immobile", town: item.municipality || "Comune non indicato", gaps });
      });
    context.candidates.filter(item => !town || normalizeNovaText(item.municipality) === normalizeNovaText(town))
      .filter(item => item.sellerClass !== "Agenzia")
      .forEach(item => {
        const quality = candidateQuality(item, context.candidates, context.listings);
        const gaps = [...quality.missing, ...quality.recommendedMissing];
        if (quality.possibleDuplicate) gaps.push("possibile duplicato");
        if (gaps.length) rows.push({ kind: "candidate", id: item.id, title: item.title || "Immobile", town: item.municipality || "Comune non indicato", gaps });
      });
    rows.sort((a, b) => b.gaps.length - a.gaps.length);
    const shown = rows.slice(0, 8);
    const actions: NovaSuggestedAction[] = shown.map(row => ({
      kind: row.kind, id: row.id,
      label: row.kind === "candidate" ? "Apri opportunità" : "Apri scheda proprietario"
    }));
    return {
      text: shown.length
        ? "Ho individuato " + rows.length + " schede da completare" + (town ? " a " + town : "") + ".\n\n"
          + shown.map((row, index) => (index + 1) + ". " + row.title + " · " + row.town
            + "\n   Da completare: " + row.gaps.join(", ")).join("\n\n")
          + "\n\nLe lacune derivano dai campi vuoti o non verificati: non vengono compilate automaticamente."
        : "Non risultano lacune informative rilevanti nelle schede attive" + (town ? " a " + town : "") + ".",
      actions
    };
  }

  if (normalized.includes("ribass") || normalized.includes("prezzo sceso")) {
    const rows: Array<{ kind: "candidate" | "listing"; id: string; title: string; town: string; observation: NovaPriceObservation; age: number; seller: string }> = [];
    context.candidates.filter(item => item.sellerClass !== "Agenzia")
      .filter(item => !town || normalizeNovaText(item.municipality) === normalizeNovaText(town))
      .forEach(item => {
        const drop = latestPriceDrop(item.priceObservations, new Date());
        if (drop && drop.ageDays >= 0 && drop.ageDays <= 30) rows.push({
          kind: "candidate", id: item.id, title: item.title || "Immobile",
          town: item.municipality || "Comune non indicato", observation: drop.observation, age: drop.ageDays,
          seller: item.sellerClass === "Privato" ? "Privato riconosciuto" : "Da verificare"
        });
      });
    context.listings.filter(item => !town || normalizeNovaText(item.municipality) === normalizeNovaText(town))
      .filter(item => !["incarico_acquisito", "non_interessato"].includes(item.status))
      .forEach(item => {
        const drop = latestPriceDrop(item.priceObservations, new Date());
        if (drop && drop.ageDays >= 0 && drop.ageDays <= 30) rows.push({
          kind: "listing", id: item.id, title: item.title || "Immobile",
          town: item.municipality || "Comune non indicato", observation: drop.observation, age: drop.ageDays,
          seller: item.sellerClass === "Privato" ? "Privato riconosciuto" : "Da verificare"
        });
      });
    rows.sort((a, b) => a.age - b.age);
    const shown = rows.slice(0, 8);
    return {
      text: shown.length
        ? "Ho trovato " + rows.length + " immobili con ribassi documentati negli ultimi 30 giorni" + (town ? " a " + town : "") + ".\n\n"
          + shown.map((row, index) => (index + 1) + ". " + row.title + " · " + row.town
            + "\n   " + formatCurrency(row.observation.previousPrice) + " → " + formatCurrency(row.observation.listingPrice)
            + " · −" + (row.observation.priceDropPercent ?? 0).toLocaleString("it-IT") + "% · "
            + (row.age === 0 ? "oggi" : row.age + " giorni fa") + "\n   Venditore: " + row.seller).join("\n\n")
          + "\n\nUn ribasso è un segnale da approfondire, non una prova di difficoltà o disponibilità a incaricare un'agenzia."
        : "Non risultano ribassi documentati negli ultimi 30 giorni" + (town ? " a " + town : "") + ".",
      actions: shown.map(row => ({
        kind: row.kind, id: row.id,
        label: row.kind === "candidate" ? "Apri opportunità" : "Apri scheda proprietario"
      }))
    };
  }

  if (normalized.includes("richiam") || normalized.includes("scadenz") || normalized.includes("appuntament") || normalized.includes("agenda")) {
    const rows = context.listings.filter(item => !town || normalizeNovaText(item.municipality) === normalizeNovaText(town))
      .filter(item => item.nextContactDate && !["incarico_acquisito", "non_interessato"].includes(item.status))
      .map(item => ({ item, date: parseDate(item.nextContactDate) }))
      .filter((row): row is { item: NovaListing; date: Date } => row.date !== null && daysBetween(new Date(), row.date) <= 7)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const overdue = rows.filter(row => daysBetween(new Date(), row.date) < 0).length;
    const dueToday = rows.filter(row => daysBetween(new Date(), row.date) === 0).length;
    return {
      text: rows.length
        ? "Ho trovato " + rows.length + " attività entro i prossimi sette giorni" + (town ? " a " + town : "")
          + ": " + overdue + " in ritardo e " + dueToday + " da fare oggi.\n\n"
          + rows.slice(0, 8).map((row, index) => (index + 1) + ". " + (row.item.title || "Immobile")
            + "\n   " + (row.item.status === "appuntamento" ? "Appuntamento" : "Richiamo")
            + " · " + formatDate(row.item.nextContactDate)
            + (row.item.municipality ? " · " + row.item.municipality : "")
          ).join("\n\n")
        : "Non risultano richiami o appuntamenti in scadenza nei prossimi sette giorni" + (town ? " a " + town : "") + ".",
      actions: rows.slice(0, 8).map(row => ({ kind: "listing", id: row.item.id, label: "Apri scheda proprietario" }))
    };
  }

  if (normalized.includes("privat") || normalized.includes("venditor")) {
    const archive = context.listings.filter(item => !town || normalizeNovaText(item.municipality) === normalizeNovaText(town));
    const candidates = context.candidates.filter(item => !town || normalizeNovaText(item.municipality) === normalizeNovaText(town));
    const archivePrivate = archive.filter(item => item.sellerClass === "Privato").length;
    const candidatePrivate = candidates.filter(item => item.sellerClass === "Privato").length;
    const unverified = candidates.filter(item => item.sellerClass === "Da verificare" || item.sellerClass === null).length;
    const wantsList = !normalized.includes("quanti") && !normalized.includes("numero") && (
      normalized.includes("mostra") || normalized.includes("miglior") || normalized.includes("lista") || !!town
    );
    if (wantsList) {
      const rows = candidates.filter(item => item.sellerClass === "Privato"
        && (!town || normalizeNovaText(item.municipality) === normalizeNovaText(town)))
        .map(item => ({ item, priority: candidatePriority(item) }))
        .sort((a, b) => b.priority.score - a.priority.score)
        .slice(0, 8);
      return {
        text: rows.length
          ? "Privati già riconosciuti" + (town ? " a " + town : "") + ":\n\n"
            + rows.map((row, index) => (index + 1) + ". " + (row.item.title || "Immobile")
              + " · " + (row.item.municipality || "Comune non indicato")
              + " · " + formatCurrency(row.item.askingPrice)
              + " · priorità " + row.priority.score + "/100").join("\n")
          : "Non risultano privati già riconosciuti" + (town ? " a " + town : "") + " nella coda attuale."
            + (unverified ? " Sono presenti " + unverified + " venditori ancora da verificare." : ""),
        actions: rows.map(row => ({ kind: "candidate", id: row.item.id, label: "Apri opportunità" }))
      };
    }
    return {
      text: (town ? "Classificazione registrata a " + town : "Classificazione attualmente registrata")
        + ":\n\nARCHIVIO: " + archivePrivate + " privati su " + archive.length + " annunci."
        + "\nCODA OPPORTUNITÀ: " + candidatePrivate + " privati riconosciuti e " + unverified
        + " venditori da verificare su " + candidates.length + " candidati.\n\n"
        + "I due gruppi non vengono sommati per evitare doppi conteggi. Un venditore da verificare non viene considerato privato.",
      actions: []
    };
  }

  if (normalized.includes("opportunit") || normalized.includes("miglior") || normalized.includes("candidat") || normalized.includes("lead")) {
    const rows = context.candidates.filter(item => !town || normalizeNovaText(item.municipality) === normalizeNovaText(town))
      .map(item => ({
        item,
        priority: candidatePriority(item),
        quality: candidateQuality(item, context.candidates, context.listings)
      }))
      .sort((a, b) => b.priority.score - a.priority.score)
      .slice(0, 8);
    return {
      text: rows.length
        ? "Le opportunità" + (town ? " a " + town : "") + ":\n\n"
          + rows.map((row, index) => topOpportunityText(row.item, row.priority, row.quality, index)).join("\n\n")
          + "\n\nIl punteggio ordina il lavoro commerciale: non è una previsione di acquisizione né una certificazione del venditore."
        : "La coda opportunità è vuota nei dati caricati" + (town ? " a " + town : "") + ".",
      actions: rows.map(row => ({ kind: "candidate", id: row.item.id, label: "Apri opportunità" }))
    };
  }

  if (normalized.includes("archiv") || normalized.includes("riepilog")) {
    const rows = context.listings.filter(item => !town || normalizeNovaText(item.municipality) === normalizeNovaText(town));
    const count = (status: string): number => rows.filter(item => item.status === status).length;
    return {
      text: "Riepilogo dell'archivio" + (town ? " a " + town : "") + ":\n\n"
        + rows.length + " annunci.\n"
        + rows.filter(item => item.sellerClass === "Privato").length + " venditori classificati come privati.\n"
        + count("da_contattare") + " da contattare · " + count("primo_contatto") + " al primo contatto · "
        + count("interessato") + " interessati · " + count("appuntamento") + " con appuntamento · "
        + count("incarico_acquisito") + " incarichi acquisiti.",
      actions: []
    };
  }

  return { text: helpText(), actions: [] };
}

export function respondToNova(message: string, context: NovaContext): NovaReply {
  const normalized = normalizeNovaText(message);
  if (!normalized) return { text: "Scriva una richiesta per iniziare.", actions: [] };
  if (normalized.includes("prepara") && (normalized.includes("telefon") || normalized.includes("chiam"))) {
    return { text: genericCallScript(), actions: [] };
  }
  if (normalized.includes("costo") || normalized.includes("costi") || normalized.includes("openai")
    || normalized.includes("api") || normalized.includes("gratis")) {
    return {
      text: "Questa versione di NOVA non invia richieste a OpenAI e non genera costi API AI. Restano separati gli eventuali normali consumi del gestionale e di Supabase.",
      actions: []
    };
  }
  if (normalized === "ciao" || normalized === "salve" || normalized.includes("buongiorno") || normalized.includes("buonasera")) {
    return { text: "Buongiorno. Sono NOVA, il Suo assistente operativo NMRE. Come posso aiutarLa con l'attività immobiliare?", actions: [] };
  }
  if (normalized.includes("aiuto") || normalized.includes("comandi") || normalized.includes("cosa sai fare")) {
    return { text: helpText(), actions: [] };
  }
  if (context.status !== "ready") return { text: unavailableDataMessage(context), actions: [] };
  return respondWithData(message, context);
}
