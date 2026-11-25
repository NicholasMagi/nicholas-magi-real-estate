const PORTALS = ["idealista.it","immobiliare.it","casa.it","subito.it","green-acres.it","green-acres.com","gate-away.com","trovacasa.it","wikicasa.it"];
const TOWNS = ["Porto Sant'Elpidio","Porto Recanati","Porto San Giorgio","Civitanova Marche","Falconara Marittima","Santa Maria Nuova","Maiolati Spontini","Monte San Vito","Monte Urano","Monte Roberto","Montecassiano","Morro d'Alba","Montemarciano","Castelfidardo","Ancona","Osimo","Loreto","Recanati","Camerano","Numana","Sirolo","Jesi","Macerata","Fermo","Senigallia","Filottrano","Polverigi","Agugliano","Offagna","Chiaravalle","Ostra","Tolentino","Staffolo","Cupramontana","Monsano","Trecastelli","Corridonia","Montegranaro"];

function normalizePropertyText(value:string):string {
  return String(value||"")
    .replace(/&amp;/gi,"&")
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi," ")
    .replace(/&euro;|&#0*8364;|&#x0*20ac;/gi,"€")
    .replace(/&sup2;|&#0*178;|&#x0*b2;/gi,"²")
    .replace(/&sup3;|&#0*179;|&#x0*b3;/gi,"³")
    .replace(/&quot;|&#0*34;/gi,'"')
    .replace(/&apos;|&#0*39;/gi,"'")
    .replace(/<[^>]*>/g," ")
    .replace(/\s+/g," ")
    .trim();
}


export function municipality(s:string):string|null {
  const normalizeTown=(value:string)=>normalizePropertyText(value)
    .toLocaleLowerCase("it")
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .trim();
  const n=" "+normalizeTown(s)+" ";
  return TOWNS.find(t=>n.includes(" "+normalizeTown(t)+" "))||null;
}


function parseItalianAmount(value:string):number|null {
  let raw=String(value||"").trim().replace(/\s+/g,"");
  let multiplier=1;
  if(/(?:mila|k)$/i.test(raw)){
    multiplier=1000;
    raw=raw.replace(/(?:mila|k)$/i,"");
  }
  if(!/^\d[\d.,]*$/.test(raw))return null;
  let amount:number;
  if(raw.includes(",")&&raw.includes(".")){
    if(raw.lastIndexOf(",")>raw.lastIndexOf("."))amount=Number(raw.replace(/\./g,"").replace(",","."));
    else amount=Number(raw.replace(/,/g,""));
  }else if(raw.includes(",")){
    const parts=raw.split(","),tail=parts.pop()||"",integer=parts.join("").replace(/\D/g,"");
    amount=/^\d{1,2}$/.test(tail)?Number(integer+"."+tail):Number(integer+tail);
  }else if(raw.includes(".")){
    const parts=raw.split("."),tail=parts[parts.length-1],prefix=parts.slice(0,-1).join("");
    if(/^\d{3}$/.test(tail)&&prefix.length<=3)amount=Number(prefix+tail);
    else amount=Number(prefix+"."+tail);
  }else amount=Number(raw);
  amount*=multiplier;
  return Number.isFinite(amount)&&amount>=10000&&amount<=100000000?Math.round(amount):null;
}

export function price(s:string):number|null {
  const value=normalizePropertyText(s);
  const number="((?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{1,2})?(?:\\s*(?:mila|k))?)";
  const patterns=[
    new RegExp("(?:€|eur)\\s*"+number,"i"),
    new RegExp(number+"\\s*(?:€|eur|euro)\\b","i"),
    new RegExp("(?:prezzo|richiesta|richiesto|in vendita(?: a)?|a partire da)\\s*[:-]?\\s*(?:€|eur)?\\s*"+number,"i")
  ];
  for(const pattern of patterns){
    const match=value.match(pattern);
    if(!match)continue;
    const amount=parseItalianAmount(match[1]);
    if(amount!==null)return amount;
  }
  return null;
}

export function listingPrice(sourceText:string,titleText:string):number|null {
  return price(sourceText) ?? price(titleText);
}

export type ListingPriceReduction = {
  currentPrice:number;
  previousPrice:number;
  reductionAmount:number;
  reductionPercent:number;
};

/** Reads only explicit portal price-reduction notation. */
export function priceReduction(value:string):ListingPriceReduction|null {
  const text=normalizePropertyText(value);
  const amount="((?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{1,2})?)";
  const pattern=new RegExp(
    "(?:€|eur)\\s*"+amount+
    "\\s*(?:€|eur)\\s*"+amount+
    "\\s*\\(\\s*[-−]\\s*(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*%\\s*\\)",
    "i"
  );
  const match=text.match(pattern);
  if(!match)return null;
  const currentPrice=parseItalianAmount(match[1]);
  const previousPrice=parseItalianAmount(match[2]);
  const declaredPercent=Number(match[3].replace(",","."));
  if(currentPrice===null||previousPrice===null||previousPrice<=currentPrice)return null;
  if(!Number.isFinite(declaredPercent)||declaredPercent<=0||declaredPercent>90)return null;
  const reductionAmount=previousPrice-currentPrice;
  const calculatedPercent=(reductionAmount/previousPrice)*100;
  if(Math.abs(calculatedPercent-declaredPercent)>0.75)return null;
  return {currentPrice,previousPrice,reductionAmount,reductionPercent:Math.round(calculatedPercent*100)/100};
}

export function propertyType(s:string):string|null {
  const value=normalizePropertyText(s);
  const patterns:Array<[string,RegExp]>=[
    ["Porzione di bifamiliare",/\bporzione\s+di\s+bifamiliare\b/i],
    ["Bifamiliare",/\bbifamiliare\b/i],
    ["Casa indipendente",/\b(?:casa indipendente|casa singola|casa autonoma)\b/i],
    ["Villetta a schiera",/\b(?:villetta|casa)\s+a\s+schiera\b/i],
    ["Villetta",/\b(?:villetta|villino)\b/i],["Villa",/\bvilla\b/i],
    ["Monolocale",/\bmonolocale\b/i],["Bilocale",/\bbilocale\b/i],
    ["Trilocale",/\btrilocale\b/i],["Quadrilocale",/\bquadrilocale\b/i],
    ["Attico",/\battico\b/i],["Mansarda",/\bmansarda\b/i],
    ["Loft",/\bloft\b/i],["Duplex",/\bduplex\b/i],
    ["Appartamento",/\bappartamento\b/i],
    ["Rustico",/\b(?:rustico|casale|cascina|colonica|podere)\b/i],
    ["Terratetto",/\bterratetto\b/i],["Terreno",/\bterreno\b/i],
    ["Garage / Box",/\b(?:garage|box auto|box|posto auto)\b/i],
    ["Locale commerciale",/\b(?:locale commerciale|fondo commerciale)\b/i],
    ["Negozio",/\bnegozio\b/i],["Ufficio",/\bufficio\b/i],
    ["Laboratorio",/\blaboratorio\b/i],["Magazzino / Deposito",/\b(?:magazzino|deposito)\b/i],
    ["Capannone",/\bcapannone\b/i]
  ];
  for(const [label,pattern] of patterns)if(pattern.test(value))return label;
  return null;
}


function parsePropertyMeasure(value:string):number|null {
  const raw=String(value||"").trim().replace(/\s+/g,"");
  if(!/^\d[\d.,]*$/.test(raw))return null;
  const separator=Math.max(raw.lastIndexOf(","),raw.lastIndexOf("."));
  let amount:number;
  if(separator>=0 && /^\d{1,2}$/.test(raw.slice(separator+1))){
    amount=Number(raw.slice(0,separator).replace(/\D/g,"")+"."+raw.slice(separator+1));
  }else{
    amount=Number(raw.replace(/\D/g,""));
  }
  return Number.isFinite(amount)&&amount>=15&&amount<=10000?Math.round(amount):null;
}

export function surface(s:string):number|null {
  const value=normalizePropertyText(s);
  const patterns=[
    /(?:superficie(?:\s+(?:commerciale|calpestabile|totale))?|metratura|mq\s+totali|sup\.?)\s*[:\-]?\s*(?:circa\s*|ca\.?\s*)?([1-9]\d{0,3}(?:[.,]\d{1,3})?)\s*(?:m²|m2|mq|metri quadrati|metri)?\b/i,
    /\b([1-9]\d{0,3}(?:[.,]\d{1,3})?)\s*(?:m²|m2|mq|metri quadrati)(?=\s|$|[.,;])/i
  ];
  for(const pattern of patterns){
    const match=value.match(pattern);
    if(!match)continue;
    const amount=parsePropertyMeasure(match[1]);
    if(amount!==null)return amount;
  }
  return null;
}


export function rooms(s:string):number|null {
  const value=normalizePropertyText(s);
  const match=value.match(/\b([1-9]\d?(?:[.,]\d)?)\s*(?:locali|vani)\b/i)
    ||value.match(/\b(?:locali|vani)\s*[:\-]?\s*([1-9]\d?(?:[.,]\d)?)\b/i);
  if(!match)return null;
  const amount=Number(match[1].replace(",","."));
  return Number.isFinite(amount)&&amount>0&&amount<=100?amount:null;
}


export function bedrooms(s:string):number|null {
  const value=normalizePropertyText(s);
  const match=value.match(/\b(\d{1,2})\s*(?:camere(?: da letto)?|camera(?: da letto)?)\b/i)
    ||value.match(/\b(?:camere(?: da letto)?|camera(?: da letto)?)\s*[:\-]?\s*(\d{1,2})\b/i);
  const amount=match?Number(match[1]):null;
  return amount!==null&&amount>=0&&amount<=20?amount:null;
}


export function bathrooms(s:string):number|null {
  const value=normalizePropertyText(s);
  const match=value.match(/\b(\d{1,2})\s*(?:bagni|bagno)\b/i)
    ||value.match(/\b(?:bagni|bagno)\s*[:\-]?\s*(\d{1,2})\b/i);
  const amount=match?Number(match[1]):null;
  return amount!==null&&amount>=0&&amount<=20?amount:null;
}


function listingUrls(s:string):string[] {
  const source=String(s||"");
  const urls=source.match(/https?:\/\/[^\s<>"']+/gi)||[];
  const found:Array<{url:string;score:number}>=[];
  const allowed=(h:string)=>PORTALS.some(d=>h===d||h.endsWith("."+d));
  for(const raw of urls){
    try{
      const u=new URL(raw.replace(/[),.;\]]+$/,""));
      const host=u.hostname.toLowerCase().replace(/^www\./,"");
      const tracker=/^(?:click|clicks|tracking|track|redirect|links?)\./i.test(host)||/(?:^|\/)(?:f\/a|track|click|redirect)\//i.test(u.pathname);
      if(!allowed(host)&&!tracker)continue;
      const position=source.indexOf(raw);
      const context=source.slice(Math.max(0,position-100),Math.min(source.length,position+raw.length+180)).toLowerCase();
      const label=/(?:vai|vedi|visualizza|scopri|guarda|apri|dettagli).{0,45}(?:annuncio|immobile|casa|appartamento)|(?:annuncio|immobile|casa|appartamento).{0,45}(?:vai|vedi|visualizza|scopri|guarda|apri|dettagli)/i.test(context);
      const detail=/\/(?:annunci|immobile)\/[^/]*\d{5,}/i.test(u.pathname)||/\/\d{6,}(?:\/|$)/.test(u.pathname);
      found.push({url:u.toString(),score:detail?1000:tracker?(label?500:10):300});
    }catch{}
  }
  const unique=new Map<string,number>();
  for(const item of found)unique.set(item.url,Math.max(unique.get(item.url)||0,item.score));
  return [...unique.entries()].sort((a,b)=>b[1]-a[1]).map(([url])=>url);
}
export function listingUrl(s:string):string|null {
  return listingUrls(s)[0]||null;
}
export async function resolveListingUrl(s:string):Promise<string|null> {
  for(const candidate of listingUrls(s).slice(0,12)){
    try{
      const initial=new URL(candidate);
      const host=initial.hostname.toLowerCase().replace(/^www\./,"");
      const tracked=/^(?:click|clicks|tracking|track|redirect|links?)\./i.test(host)||/(?:^|\/)(?:f\/a|track|click|redirect)\//i.test(initial.pathname);
      if(!tracked){
        if(isSpecificListingUrl(initial))return initial.toString();
        continue;
      }
      const response=await fetch(candidate,{method:"GET",redirect:"follow",headers:{Accept:"text/html"},signal:AbortSignal.timeout(6000)});
      const finalUrl=new URL(response.url||candidate);
      if(isSpecificListingUrl(finalUrl))return finalUrl.toString();
    }catch{}
  }
  return null;
}
export function propertyEmail(e:any):boolean {
  const subject=String(e.subject||"").toLocaleLowerCase("it");
  const text=[e.subject,e.snippet,e.bodyText].filter(Boolean).join(" ").toLocaleLowerCase("it");
  const excluded=/(verifica il tuo indirizzo|verifica la tua email|hai condiviso alcuni dati|account google|benvenuto|ben arrivato|richiesta di contatto di recupero|ricerca (?:è stata )?salvata|password|reimposta|newsletter|promozion[ei]|subitopiù|attiva il tuo account|conferma il tuo indirizzo|asta giudiziaria|annuncio all['’]asta|\ball['’]asta\b|\baste immobiliari\b|\btribunale\b|\bvendi\s+all['’]asta\b|\bpiena proprietà\s+all['’]asta\b)/i;
  if(excluded.test(subject)||excluded.test(text))return false;
  const alertPattern=/(?:\b\d+\s+)?nuov[oi]\s+(?:annunci[oi]?|immobili|case|appartamenti|ville|proprietà)\b|annunci?\s+(?:appena )?pubblicat[oi]|nuov[oi]\s+immobil[ei]|nuov[ae]\s+proprietà|annuncio.{0,100}(?:tua ricerca|vendita|immobiliare)/i;
  if(!alertPattern.test(subject)&&!alertPattern.test(text.slice(0,5000)))return false;
  const url=listingUrl(text);
  if(!url)return false;
  try{
    const parsed=new URL(url);
    if(parsed.pathname==="/"||/\/(?:vendere|verify-email|login|register|account|search|ricerca|subitopiu)(?:\/|$)/i.test(parsed.pathname))return false;
  }catch{return false;}
  return true;
}
export function listingTitle(e:any):string {
  const body=normalizePropertyText(String(e.bodyText||"").replace(/https?:\/\/\S+/g," "));
  const propertyPattern=/\b(?:casa indipendente|villetta|villa|monolocale|bilocale|trilocale|quadrilocale|appartamento|attico|mansarda|rustico|casale|terratetto|terreno|garage|box auto|negozio|ufficio|capannone)\b/i;
  const match=propertyPattern.exec(body);
  if(match){
    const start=Math.max(0,match.index-55);
    const phrase=body.slice(start,Math.min(body.length,match.index+100))
      .replace(/^(?:dettagli|scopri|guarda|visualizza|nuovo annuncio)\s*[:\-·]?\s*/i,"")
      .replace(/\s+/g," ").trim();
    if(phrase.length>=10)return phrase.slice(0,250);
  }
  const subject=normalizePropertyText(e.subject||"");
  const subjectMatch=subject.match(/(?:\d+\s+)?nuov[oi]\s+annunci?[oi]?.{0,140}:\s*(.+)$/i);
  if(subjectMatch?.[1])return ("Nuovo annuncio · "+subjectMatch[1].trim()).slice(0,250);
  return (subject||"Nuovo annuncio immobiliare").slice(0,250);
}


function isSpecificListingUrl(value:URL):boolean {
  const host=value.hostname.toLowerCase().replace(/^www\./,"");
  const path=value.pathname;
  const isImmobiliare=host==="immobiliare.it"||host.endsWith(".immobiliare.it");
  if(isImmobiliare){
    return /\/(?:annunci|immobile)\/[^/]*\d{5,}[^/]*(?:\/|$)/i.test(path);
  }
  if(path==="/"||/\/(?:search|ricerca|vendita|affitto|case-in-vendita|immobili-in-vendita)(?:\/|$)/i.test(path)){
    return false;
  }
  return /\/(?:annuncio|annunci|immobile|immobili|property|listing|detail)\/[^/]+/i.test(path)
    || /\/[^/]*\d{6,}[^/]*(?:\.html?)?\/?$/i.test(path);
}

export type SellerClassification = "Privato" | "Da verificare" | "Agenzia";
export function sellerClassificationDetails(value:string):{classification:SellerClassification;confidence:number;evidence:string} {
  const text=String(value||"").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
  const agencySignals:Array<{pattern:RegExp;label:string;confidence:number}>=[
    {pattern:/(?:venditore|inserzionista|proposto da|pubblicato da|annuncio di|a cura di|gestito da)\s*[:\-]?\s*(?:un[ao]?\s+)?(?:agenzia(?:\s+immobiliare)?|agente immobiliare|studio immobiliare|società immobiliare|professionista immobiliare)\b/i,label:"Venditore indicato come agenzia o professionista",confidence:98},
    {pattern:/\b(?:contatta|rivolgiti a|referente|agenzia di riferimento|annuncio gestito da|gestito da)\b.{0,90}\b(?:agenzia(?: immobiliare)?|agente immobiliare|studio immobiliare|intermediazione immobiliare|mediazione immobiliare)\b/i,label:"Indicazione di contatto o gestione da parte di un'agenzia",confidence:94},
    {pattern:/\b(?:proposto da|inserzionista|annuncio di|pubblicato da)\s*[:\-]?\s*[^.;,]{2,90}\b(?:immobiliare|real estate|property|re\/max|remax|tempocasa|tecnocasa|gabetti|engel\s*&\s*völkers|professionecasa|iad)\b/i,label:"Inserzionista riconducibile a un marchio immobiliare",confidence:95},
    {pattern:/\b(?:immobiliare|real estate)\b[^.;,]{0,45}\b(?:s\.?r\.?l\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|s\.?p\.?a\.?)\b/i,label:"Società immobiliare con forma societaria",confidence:93},
    {pattern:/\b(?:proposto da|inserzionista|annuncio di|pubblicato da|gestito da)\s*[:\-]?\s*[^.;,]{0,90}\b(?:re\/max|remax|tempocasa|tecnocasa|gabetti|engel\s*&\s*völkers|professionecasa|iad)\b/i,label:"Inserzionista identificato con un marchio immobiliare",confidence:96}
  ];
  const privateSignals:Array<{pattern:RegExp;label:string;confidence:number}>=[
    {pattern:/\b(?:venditore|tipo venditore|inserzionista|proprietario|pubblicato da)\s*[:\-]?\s*(?:un\s+)?privato\b/i,label:"Etichetta esplicita: venditore privato",confidence:99},
    {pattern:/\b(?:annuncio|vendita|proposta)\s+(?:diretta\s+)?(?:da|tra)\s+privati\b/i,label:"Annuncio o vendita tra privati",confidence:97},
    {pattern:/\b(?:senza|no)\s+(?:agenzia|intermediari[oa])\b/i,label:"Assenza dichiarata di agenzia o intermediari",confidence:96},
    {pattern:/\b(?:privato|proprietario)\s+(?:vende|propone|mette in vendita)\b/i,label:"Vendita dichiarata direttamente dal proprietario",confidence:94},
    {pattern:/\b(?:da|venduto da|in vendita da)\s+(?:un\s+)?proprietario\b/i,label:"Vendita indicata direttamente dal proprietario",confidence:91}
  ];
  const agency=agencySignals.find(signal=>signal.pattern.test(text));
  const privateMatch=privateSignals.find(signal=>signal.pattern.test(text));
  if(agency&&privateMatch)return {classification:"Da verificare",confidence:0,evidence:"Segnali contrastanti: controllo manuale necessario"};
  if(agency)return {classification:"Agenzia",confidence:agency.confidence,evidence:agency.label};
  if(privateMatch)return {classification:"Privato",confidence:privateMatch.confidence,evidence:privateMatch.label};
  return {classification:"Da verificare",confidence:0,evidence:"Nessuna indicazione affidabile sul tipo di venditore nell'email"};
}
export function sellerClassification(value:string):SellerClassification {
  return sellerClassificationDetails(value).classification;
}

export function extractAdditionalPropertyDetails(value:string):Record<string,unknown> {
  const text=normalizePropertyText(value);
  const result:Record<string,unknown>={};
  const address=text.match(/\b(?:via|viale|v\.le|piazza|p\.zza|corso|c\.so|vicolo|vico|strada|contrada|località|loc\.)\s+[^,;|]{2,70}/i);
  if(address) result.indirizzo_rilevato=address[0].trim().slice(0,100);
  const floor=text.match(/\b(?:piano\s+(?:terra|rialzato|ammezzato|primo|secondo|terzo|quarto|quinto|ultimo|[0-9]{1,2}°?)|[0-9]{1,2}°\s+piano)\b/i);
  if(floor) result.piano=floor[0].trim();
  const energy=text.match(/\bclasse energetica\s*[:\-]?\s*(A4|A3|A2|A1|A|B|C|D|E|F|G)\b/i);
  if(energy) result.classe_energetica=energy[1].toUpperCase();
  const year=text.match(/\b(?:anno\s+(?:di\s+)?costruzione|costruito\s+nel|edificato\s+nel)\s*[:\-]?\s*((?:19|20)\d{2})\b/i);
  if(year) result.anno_costruzione=Number(year[1]);
  const heating=text.match(/\briscaldamento\s*[:\-]?\s*(autonomo|centralizzato|a\s+pavimento|pompa\s+di\s+calore|assente)\b/i);
  if(heating) result.riscaldamento=heating[1].toLocaleLowerCase("it");
  const condition=text.match(/\b(da\s+ristrutturare|ristrutturato(?:\s+(?:a\s+nuovo|recentemente))?|ottimo\s+stato|buono\s+stato|abitabile|nuova\s+costruzione|in\s+costruzione)\b/i);
  if(condition) result.stato_immobile=condition[1].toLocaleLowerCase("it");
  if(/\b(?:con\s+ascensore|ascensore\s+presente)\b/i.test(text)) result.ascensore=true;
  else if(/\b(?:senza\s+ascensore|ascensore\s+assente)\b/i.test(text)) result.ascensore=false;
  const extras:string[]=[];
  const patterns:Array<[string,RegExp]>=[
    ["balcone",/\bbalconi?\b/i],["terrazzo",/\bterrazzi?\b/i],
    ["giardino",/\bgiardino\b/i],["garage",/\bgarage\b/i],
    ["posto auto",/\bposto\s+auto\b/i],["cantina",/\bcantina\b/i]
  ];
  for(const [label,pattern] of patterns) if(pattern.test(text)) extras.push(label);
  if(extras.length) result.dotazioni_rilevate=extras;
  if(/\b(?:arredat[oa]|completamente\s+arredat[oa])\b/i.test(text)) result.arredamento="arredato";
  else if(/\bnon\s+arredat[oa]\b/i.test(text)) result.arredamento="non arredato";
  return result;
}


/**
 * Stable key for a verified portal listing.
 * Query parameters and fragments are excluded because portal tracking tokens
 * do not change the identity of a listing. Generic/search URLs are rejected.
 */
export function canonicalListingKey(value:string|null|undefined):string|null {
  if(!value)return null;
  try{
    const url=new URL(value);
    const host=url.hostname.toLowerCase().replace(/^www\./,"");
    const allowed=PORTALS.some(domain=>host===domain||host.endsWith("."+domain));
    if(!allowed||!isSpecificListingUrl(url))return null;
    const path=decodeURIComponent(url.pathname).replace(/\/+$/,"").toLowerCase()||"/";
    return host+path;
  }catch{
    return null;
  }
}


export interface ListingIdentitySnapshot {
  id?: string | null; listing_key?: string | null; url?: string | null; url_originale?: string | null;
  titolo?: string | null; title?: string | null; comune?: string | null; municipality?: string | null;
  prezzo?: number | string | null; price?: number | string | null;
  tipologia_immobile?: string | null; property_type?: string | null;
  superficie_mq?: number | string | null; surface_sqm?: number | string | null;
  locali?: number | string | null; rooms?: number | string | null;
  camere?: number | string | null; bedrooms?: number | string | null;
  bagni?: number | string | null; bathrooms?: number | string | null;
  dati_estratti?: unknown; extracted_data?: unknown; indirizzo?: string | null;
}
export interface ListingIdentityMatch { kind: "strong" | "possible" | "none"; confidence: number; reason: string | null; }
const IDENTITY_STOP_WORDS = new Set([
  "appartamento","immobile","immobiliare","casa","vendita","vendesi","affitto","nuovo","nuova",
  "privato","annuncio","annunci","mq","zona","centro","proposta","offerta","splendido","ottimo",
  "ampio","luminoso","panoramico","con","per","in","da","di","del","della","delle","dei","degli",
  "alla","alle","allo","un","una","uno","the"
]);
function identityValue(record:ListingIdentitySnapshot,italian:keyof ListingIdentitySnapshot,english?:keyof ListingIdentitySnapshot):unknown {
  const primary=record[italian];
  return primary!==null&&primary!==undefined&&primary!==""?primary:english?record[english]:null;
}
function identityObject(value:unknown):Record<string,unknown> {
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function normalizeIdentityText(value:unknown):string {
  return normalizePropertyText(String(value??"")).normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLocaleLowerCase("it-IT").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function identityTokens(value:unknown):Set<string> {
  return new Set(normalizeIdentityText(value).split(" ").filter(token=>token.length>2&&!IDENTITY_STOP_WORDS.has(token)));
}
function tokenJaccard(left:Set<string>,right:Set<string>):number {
  if(!left.size||!right.size)return 0;
  let common=0;left.forEach(token=>{if(right.has(token))common++;});
  return common/(left.size+right.size-common);
}
function listingAddress(record:ListingIdentitySnapshot):string|null {
  if(typeof record.indirizzo==="string"&&record.indirizzo.trim())return record.indirizzo.trim();
  const extracted=identityObject(record.dati_estratti??record.extracted_data);
  const page=identityObject(extracted.pagina_pubblica);
  const suggestions=identityObject(page.suggestions);
  const value=extracted.indirizzo_rilevato??extracted.indirizzo??suggestions.indirizzo;
  return typeof value==="string"&&value.trim()?value.trim():null;
}
function addressParts(value:string|null):{street:Set<string>;numbers:Set<string>} {
  if(!value)return {street:new Set(),numbers:new Set()};
  const normalized=normalizeIdentityText(value).replace(/\bviale\b|\bv le\b|\bvle\b/g," viale ")
    .replace(/\bv\b/g," via ").replace(/\bp zza\b|\bpiazza\b/g," piazza ")
    .replace(/\bc so\b|\bcorso\b/g," corso ").replace(/\bstr\b/g," strada ");
  const tokens=normalized.split(" ").filter(Boolean);
  const numbers=new Set(tokens.filter(token=>/^\d+[a-z]?(?:\/\d+[a-z]?)?$/.test(token)));
  const streetWords=tokens.filter(token=>!/^\d+[a-z]?(?:\/\d+[a-z]?)?$/.test(token)&&token.length>1&&
    !["via","viale","piazza","corso","strada","contrada","localita","loc","di","del","della","dei","delle","degli"].includes(token));
  return {street:new Set(streetWords),numbers};
}
function propertyTypeGroup(value:unknown):string|null {
  const text=normalizeIdentityText(value);
  if(!text)return null;
  if(/\b(terreno|lotto)\b/.test(text))return "terreno";
  if(/\b(garage|box|posto auto|cantina)\b/.test(text))return "pertinenza";
  if(/\b(negozio|ufficio|commerciale|capannone|magazzino|laboratorio)\b/.test(text))return "commerciale";
  if(/\b(appartamento|monolocale|bilocale|trilocale|quadrilocale|attico|mansarda|loft|duplex)\b/.test(text))return "appartamento";
  if(/\b(villa|villetta|bifamiliare|casa indipendente|terratetto|rustico|casale|colonica|podere)\b/.test(text))return "casa";
  return null;
}
function closeNumber(left:unknown,right:unknown,absolute:number,relative:number):boolean {
  const a=Number(left),b=Number(right);
  return Number.isFinite(a)&&Number.isFinite(b)&&a>0&&b>0&&Math.abs(a-b)<=Math.max(absolute,Math.min(a,b)*relative);
}
function closeInteger(left:unknown,right:unknown,tolerance:number):boolean {
  const a=Number(left),b=Number(right);return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
}

/** Conservative cross-portal match: exact civic address or several independent listing attributes. */
export function compareListingIdentity(incoming:ListingIdentitySnapshot,existing:ListingIdentitySnapshot):ListingIdentityMatch {
  const incomingUrlKey=canonicalListingKey(incoming.url??incoming.url_originale);
  const existingUrlKey=canonicalListingKey(existing.url??existing.url_originale);
  if(incomingUrlKey&&existingUrlKey&&incomingUrlKey===existingUrlKey)return {kind:"strong",confidence:100,reason:"Stesso collegamento canonico all'annuncio."};
  const incomingTown=normalizeIdentityText(identityValue(incoming,"comune","municipality"));
  const existingTown=normalizeIdentityText(identityValue(existing,"comune","municipality"));
  if(!incomingTown||!existingTown||incomingTown!==existingTown)return {kind:"none",confidence:0,reason:null};
  const incomingType=propertyTypeGroup(identityValue(incoming,"tipologia_immobile","property_type"));
  const existingType=propertyTypeGroup(identityValue(existing,"tipologia_immobile","property_type"));
  if(incomingType&&existingType&&incomingType!==existingType)return {kind:"none",confidence:0,reason:null};
  const incomingSurface=identityValue(incoming,"superficie_mq","surface_sqm");
  const existingSurface=identityValue(existing,"superficie_mq","surface_sqm");
  const surfaceClose=closeNumber(incomingSurface,existingSurface,5,0.06);
  const surfaceConflict=Number(incomingSurface)>0&&Number(existingSurface)>0&&!surfaceClose&&
    Math.abs(Number(incomingSurface)-Number(existingSurface))/Math.min(Number(incomingSurface),Number(existingSurface))>0.2;
  const roomsClose=closeInteger(identityValue(incoming,"locali","rooms"),identityValue(existing,"locali","rooms"),0.5);
  const bedroomsClose=closeInteger(identityValue(incoming,"camere","bedrooms"),identityValue(existing,"camere","bedrooms"),1);
  const bathroomsClose=closeInteger(identityValue(incoming,"bagni","bathrooms"),identityValue(existing,"bagni","bathrooms"),1);
  const priceClose=closeNumber(identityValue(incoming,"prezzo","price"),identityValue(existing,"prezzo","price"),6000,0.08);
  const leftAddress=addressParts(listingAddress(incoming)),rightAddress=addressParts(listingAddress(existing));
  const addressSimilarity=tokenJaccard(leftAddress.street,rightAddress.street);
  const bothAddresses=leftAddress.street.size>0&&rightAddress.street.size>0;
  const differentCivicNumbers=leftAddress.numbers.size>0&&rightAddress.numbers.size>0&&
    ![...leftAddress.numbers].some(number=>rightAddress.numbers.has(number));
  const addressConflict=bothAddresses&&((differentCivicNumbers&&addressSimilarity>=0.65)||addressSimilarity<0.25);
  if(addressConflict||surfaceConflict)return {kind:"none",confidence:0,reason:null};
  const addressWithCivicNumber=bothAddresses&&addressSimilarity>=0.8&&leftAddress.numbers.size>0&&
    [...leftAddress.numbers].some(number=>rightAddress.numbers.has(number));
  const addressPartial=bothAddresses&&addressSimilarity>=0.65;
  const titleTokens=tokenJaccard(identityTokens(identityValue(incoming,"titolo","title")),identityTokens(identityValue(existing,"titolo","title")));
  const typeClose=!!incomingType&&!!existingType&&incomingType===existingType;
  let score=10;
  if(typeClose)score+=15;if(surfaceClose)score+=22;if(roomsClose)score+=10;if(bedroomsClose)score+=7;
  if(bathroomsClose)score+=4;if(priceClose)score+=16;score+=Math.round(titleTokens*16);
  if(addressPartial)score+=10;if(addressWithCivicNumber)score+=24;
  const confidence=Math.min(100,Math.round(score/120*100));
  const hasBothSurfaces=Number(incomingSurface)>0&&Number(existingSurface)>0;
  const incomingRooms=identityValue(incoming,"locali","rooms");
  const existingRooms=identityValue(existing,"locali","rooms");
  const hasBothRooms=Number(incomingRooms)>0&&Number(existingRooms)>0;
  const addressUnitCompatible=
    (hasBothSurfaces&&surfaceClose&&(!hasBothRooms||roomsClose))||
    (hasBothRooms&&roomsClose&&(bedroomsClose||bathroomsClose||priceClose))||
    (titleTokens>=0.8&&priceClose&&(surfaceClose||roomsClose));
  if(addressWithCivicNumber&&addressUnitCompatible&&(!incomingType||!existingType||typeClose))
    return {kind:"strong",confidence:Math.max(95,confidence),reason:"Comune e indirizzo con numero civico coincidono; tipologia compatibile."};
  const strongProfile=typeClose&&surfaceClose&&priceClose&&(
    (roomsClose&&titleTokens>=0.62)||(titleTokens>=0.82&&(roomsClose||bedroomsClose))||
    (roomsClose&&bedroomsClose&&bathroomsClose&&titleTokens>=0.4)
  );
  if(strongProfile)return {kind:"strong",confidence:Math.max(88,confidence),reason:"Comune, tipologia, metratura e prezzo coincidono; anche titolo o distribuzione dei locali sono molto simili."};
  const supporting=[typeClose,surfaceClose,roomsClose,bedroomsClose,bathroomsClose,priceClose,titleTokens>=0.55,addressPartial].filter(Boolean).length;
  if(supporting>=2&&(typeClose||addressPartial)&&(surfaceClose||priceClose||titleTokens>=0.55||addressPartial)&&confidence>=45)
    return {kind:"possible",confidence,reason:"Alcuni dati coincidono, ma non sono sufficienti per unire automaticamente i due annunci."};
  return {kind:"none",confidence:0,reason:null};
}
