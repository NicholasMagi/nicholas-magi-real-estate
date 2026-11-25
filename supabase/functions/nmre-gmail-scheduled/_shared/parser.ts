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
  const source=String(s||"").replace(/&amp;/gi,"&").replace(/&#x2f;|&#47;/gi,"/");
  const queue:string[]=[...(source.match(/https?:\/\/[^\s<>"']+/gi)||[])];
  const found:Array<{url:string;score:number}>=[];
  const seen=new Set<string>();
  const allowed=(h:string)=>PORTALS.some(d=>h===d||h.endsWith("."+d));
  const trackerHost=(host:string)=>/^(?:click|clicks|tracking|track|redirect|links?)\./i.test(host)
    ||host==="google.com"||host.endsWith(".google.com")||host==="t.co";
  const redirectKeys=["url","u","q","target","dest","destination","redirect","redirect_url","redirect_uri","to","link","adurl","deep_link"];
  while(queue.length&&seen.size<80){
    const raw=queue.shift()!;
    if(seen.has(raw))continue;
    seen.add(raw);
    try{
      const cleaned=raw.replace(/[),.;\]]+$/,"").replace(/&amp;/gi,"&");
      const u=new URL(cleaned);
      const host=u.hostname.toLowerCase().replace(/^www\./,"");
      const isPortal=allowed(host);
      const isTracker=trackerHost(host)||/(?:^|\/)(?:f\/a|track|click|redirect)\//i.test(u.pathname)||((host==="google.com"||host.endsWith(".google.com"))&&u.pathname==="/url");
      if(!isPortal&&!isTracker)continue;
      const position=source.indexOf(raw);
      const context=source.slice(Math.max(0,position-160),Math.min(source.length,position+raw.length+220)).toLowerCase();
      const label=/(?:vai|vedi|visualizza|scopri|guarda|apri|dettagli).{0,60}(?:annuncio|immobile|casa|appartamento)|(?:annuncio|immobile|casa|appartamento).{0,60}(?:vai|vedi|visualizza|scopri|guarda|apri|dettagli)/i.test(context);
      const detail=/\/(?:annunci|immobile)\/[^/]*\d{5,}/i.test(u.pathname)||/\/\d{6,}(?:\/|$)/.test(u.pathname);
      if(isPortal)found.push({url:u.toString(),score:detail?1200:300+(label?80:0)});
      if(isTracker){
        for(const key of redirectKeys){
          const value=u.searchParams.get(key);
          if(value&&/^https?:\/\//i.test(value)){
            queue.push(value);
            try{
              const nested=new URL(value);
              if(allowed(nested.hostname.toLowerCase().replace(/^www\./,"")))found.push({url:nested.toString(),score:1400});
            }catch{}
          }
        }
      }
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
  for(const candidate of listingUrls(s).slice(0,20)){
    try{
      const initial=new URL(candidate);
      const host=initial.hostname.toLowerCase().replace(/^www\./,"");
      const tracked=/^(?:click|clicks|tracking|track|redirect|links?)\./i.test(host)
        ||host==="google.com"||host.endsWith(".google.com")
        ||/(?:^|\/)(?:f\/a|track|click|redirect)\//i.test(initial.pathname);
      if(!tracked){
        if(isSpecificListingUrl(initial))return initial.toString();
        continue;
      }
      const response=await fetch(candidate,{method:"GET",redirect:"follow",headers:{Accept:"text/html"},signal:AbortSignal.timeout(8000)});
      const finalUrl=new URL(response.url||candidate);
      if(isSpecificListingUrl(finalUrl))return finalUrl.toString();
    }catch{}
  }
  return null;
}
// Regole del filtro avvisi, con il nome usato nella diagnostica. Il comportamento
// è identico a quello storico di propertyEmail(): la funzione restituisce in più
// quale regola ha escluso l'email, per misurare le esclusioni senza salvare testi.
export type PropertyEmailRule =
  | "accettata"
  | "esclusione_nell_oggetto"
  | "esclusione_nel_testo"
  | "nessun_segnale_di_avviso"
  | "nessun_link_annuncio"
  | "link_principale_generico";
export function propertyEmailDecision(e:any):{accepted:boolean;rule:PropertyEmailRule} {
  const subject=String(e.subject||"").toLocaleLowerCase("it");
  const text=[e.subject,e.snippet,e.bodyText].filter(Boolean).join(" ").toLocaleLowerCase("it");
  if(PROPERTY_EMAIL_EXCLUDED.test(subject))return {accepted:false,rule:"esclusione_nell_oggetto"};
  if(PROPERTY_EMAIL_EXCLUDED.test(text))return {accepted:false,rule:"esclusione_nel_testo"};
  if(!PROPERTY_EMAIL_ALERT.test(subject)&&!PROPERTY_EMAIL_ALERT.test(text.slice(0,5000)))return {accepted:false,rule:"nessun_segnale_di_avviso"};
  const url=listingUrl(text);
  if(!url)return {accepted:false,rule:"nessun_link_annuncio"};
  try{
    const parsed=new URL(url);
    if(parsed.pathname==="/"||/\/(?:vendere|verify-email|login|register|account|search|ricerca|subitopiu)(?:\/|$)/i.test(parsed.pathname))return {accepted:false,rule:"link_principale_generico"};
  }catch{return {accepted:false,rule:"link_principale_generico"};}
  return {accepted:true,rule:"accettata"};
}
const PROPERTY_EMAIL_EXCLUDED=/(verifica il tuo indirizzo|verifica la tua email|hai condiviso alcuni dati|account google|benvenuto|ben arrivato|richiesta di contatto di recupero|ricerca (?:è stata )?salvata|password|reimposta|newsletter|promozion[ei]|subitopiù|attiva il tuo account|conferma il tuo indirizzo|asta giudiziaria|annuncio all['’]asta|\ball['’]asta\b|\baste immobiliari\b|\btribunale\b|\bvendi\s+all['’]asta\b|\bpiena proprietà\s+all['’]asta\b)/i;
const PROPERTY_EMAIL_ALERT=/(?:\b\d+\s+)?nuov[oi]\s+(?:annunci[oi]?|immobili|case|appartamenti|ville|proprietà)\b|annunci?\s+(?:appena )?pubblicat[oi]|nuov[oi]\s+immobil[ei]|nuov[ae]\s+proprietà|annuncio.{0,100}(?:tua ricerca|vendita|immobiliare)/i;
export function propertyEmail(e:any):boolean {
  return propertyEmailDecision(e).accepted;
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
