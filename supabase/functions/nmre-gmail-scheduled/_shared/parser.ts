const PORTALS = ["idealista.it","immobiliare.it","casa.it","subito.it","green-acres.it","green-acres.com","gate-away.com","trovacasa.it","wikicasa.it"];
const TOWNS = ["Porto Sant'Elpidio","Porto Recanati","Porto San Giorgio","Civitanova Marche","Falconara Marittima","Santa Maria Nuova","Maiolati Spontini","Monte San Vito","Monte Urano","Monte Roberto","Montecassiano","Morro d'Alba","Montemarciano","Castelfidardo","Ancona","Osimo","Loreto","Recanati","Camerano","Numana","Sirolo","Jesi","Macerata","Fermo","Senigallia","Filottrano","Polverigi","Agugliano","Offagna","Chiaravalle","Ostra","Tolentino","Staffolo","Cupramontana","Monsano","Trecastelli","Corridonia","Montegranaro"];

export function municipality(s:string):string|null {
  const n=" "+String(s||"").toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]+/gu," ")+" ";
  return TOWNS.find(t=>n.includes(" "+t.toLocaleLowerCase("it")+" "))||null;
}
export function price(s:string):number|null {
  const patterns=[
    /(?:€|eur)\s*([0-9][0-9\s.,]*)/i,
    /([0-9][0-9\s.,]*)\s*(?:€|eur)/i,
    /(?:prezzo|richiesta|in vendita(?: a)?)\s*[:\-]?\s*(?:€|eur)?\s*([0-9][0-9\s.,]*)/i
  ];
  for(const pattern of patterns){
    const match=String(s||"").match(pattern);
    if(!match)continue;
    let raw=match[1].replace(/\s/g,"");
    const separator=Math.max(raw.lastIndexOf(","),raw.lastIndexOf("."));
    if(separator>=0 && /^\d{1,2}$/.test(raw.slice(separator+1)) && raw.slice(0,separator).replace(/\D/g,"").length>=2){
      raw=raw.slice(0,separator).replace(/\D/g,"")+"."+raw.slice(separator+1);
    }else{
      raw=raw.replace(/\D/g,"");
    }
    const amount=Number(raw);
    if(Number.isFinite(amount)&&amount>=10000&&amount<=100000000)return Math.round(amount);
  }
  return null;
}
export function propertyType(s:string):string|null {
  const patterns:Array<[string,RegExp]>=[
    ["Casa indipendente",/\b(?:casa indipendente|casa singola)\b/i],
    ["Villetta",/\b(?:villetta|villino)\b/i],["Villa",/\bvilla\b/i],
    ["Monolocale",/\bmonolocale\b/i],["Bilocale",/\bbilocale\b/i],
    ["Trilocale",/\btrilocale\b/i],["Quadrilocale",/\bquadrilocale\b/i],
    ["Attico",/\battico\b/i],["Mansarda",/\bmansarda\b/i],
    ["Appartamento",/\bappartamento\b/i],
    ["Rustico",/\b(?:rustico|casale|cascina|colonica|podere)\b/i],
    ["Terratetto",/\bterratetto\b/i],["Terreno",/\bterreno\b/i],
    ["Garage / Box",/\b(?:garage|box auto|box)\b/i],["Negozio",/\bnegozio\b/i],
    ["Ufficio",/\bufficio\b/i],["Capannone",/\bcapannone\b/i]
  ];
  for(const [label,pattern] of patterns)if(pattern.test(String(s||"")))return label;
  return null;
}
export function surface(s:string):number|null {
  const value=String(s||"");
  const patterns=[
    /(?:superficie|metratura|sup\.?)\s*[:\-]?\s*([1-9]\d{0,3}(?:[.,]\d{1,3})?)\s*(?:m²|mq|metri quadrati)?/i,
    /\b([1-9]\d{0,3}(?:[.,]\d{1,3})?)\s*(?:m²|mq|metri quadrati)\b/i
  ];
  for(const pattern of patterns){
    const match=value.match(pattern);
    if(!match)continue;
    const raw=match[1].replace(/\s/g,"");
    const n=/^[1-9]\d{0,2}[.,]\d{3}$/.test(raw)
      ?Number(raw.replace(/[.,]/g,""))
      :Math.floor(Number(raw.replace(",", ".")));
    if(Number.isInteger(n)&&n>=15&&n<=10000)return n;
  }
  return null;
}
export function rooms(s:string):number|null {
  const match=String(s||"").match(/\b([1-9]\d?(?:[.,]\d)?)\s*(?:locali|vani)\b/i);
  if(!match)return null;
  const value=Number(match[1].replace(",","."));
  return Number.isFinite(value)&&value>0&&value<=100?value:null;
}
export function bedrooms(s:string):number|null {
  const match=String(s||"").match(/\b(\d{1,2})\s*(?:camere(?: da letto)?|camera(?: da letto)?)\b|\b(?:camere(?: da letto)?|camera(?: da letto)?)\s*[:\-]?\s*(\d{1,2})\b/i);
  const value=match?Number(match[1]||match[2]):null;
  return value!==null&&value>=0&&value<=20?value:null;
}
export function bathrooms(s:string):number|null {
  const match=String(s||"").match(/\b(\d{1,2})\s*(?:bagni|bagno)\b|\b(?:bagni|bagno)\s*[:\-]?\s*(\d{1,2})\b/i);
  const value=match?Number(match[1]||match[2]):null;
  return value!==null&&value>=0&&value<=20?value:null;
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
      const response=await fetch(candidate,{redirect:"follow",headers:{Accept:"text/html"},signal:AbortSignal.timeout(6000)});
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
  const body=String(e.bodyText||"").replace(/https?:\/\/\S+/g," ").replace(/\s+/g," ").trim();
  const propertyPattern=/\b(?:casa indipendente|villetta|villa|monolocale|bilocale|trilocale|quadrilocale|appartamento|attico|mansarda|rustico|casale|terratetto|terreno|garage|box auto|negozio|ufficio|capannone)\b/i;
  const match=propertyPattern.exec(body);
  if(match){
    const start=Math.max(0,match.index-55);
    const phrase=body.slice(start,Math.min(body.length,match.index+100))
      .replace(/^(?:dettagli|scopri|guarda|visualizza|nuovo annuncio)\s*[:\-·]?\s*/i,"")
      .replace(/\s+/g," ").trim();
    if(phrase.length>=10)return phrase.slice(0,250);
  }
  const subject=String(e.subject||"").trim();
  const subjectMatch=subject.match(/(?:\d+\s+)?nuov[oi]\s+annunci?[oi]?.{0,140}?:\s*(.+)$/i);
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
