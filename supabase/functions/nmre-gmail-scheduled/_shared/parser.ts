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
    /(?:superficie|metratura|sup\.?)\s*[:\-]?\s*([1-9]\d{1,3})(?:[.,]\d+)?\s*(?:m²|mq|metri quadrati)?/i,
    /\b([1-9]\d{1,3})(?:[.,]\d+)?\s*(?:m²|mq|metri quadrati)\b/i
  ];
  for(const pattern of patterns){
    const match=value.match(pattern);
    if(match){const n=Number(match[1]);if(Number.isInteger(n)&&n>=15&&n<=10000)return n;}
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
export function listingUrl(s:string):string|null {
  const ignored=["unsubscribe","unsub","privacy","terms","cookie","pixel","newsletter","preferences","account","login","register"];
  const urls=String(s||"").match(/https?:\/\/[^\s<>"']+/gi)||[];
  const found:Array<{url:string;score:number}>=[];
  const allowed=(h:string)=>PORTALS.some(d=>h===d||h.endsWith("."+d));
  for(const raw of urls){try{
    let u=new URL(raw.replace(/[),.;\]]+$/,""));
    for(let i=0;i<3;i++){
      const h=u.hostname.toLowerCase().replace(/^www\./,"");
      if(allowed(h)){
        const nested=["url","target","dest","destination","redirect","redirect_url","adurl","u"].map(k=>u.searchParams.get(k)).find(Boolean);
        if(nested){try{const v=new URL(nested,u);if(allowed(v.hostname.toLowerCase().replace(/^www\./,""))){u=v;continue;}}catch{}}
        if(ignored.some(w=>(h+" "+u.pathname+" "+u.search).toLowerCase().includes(w)))break;
        if(/\.(png|jpe?g|gif|webp|svg|css|js)(\?|$)/i.test(u.pathname))break;
        const host=u.hostname.toLowerCase().replace(/^www\./,"");
        const tracker=/^(?:click|clicks|tracking|track|redirect|links?)\./i.test(host)||/\/(?:f\/a|track|click|redirect)\//i.test(u.pathname);
        const detail=/\/(?:immobili?|annunci?|appartamenti?|case(?:-in-vendita)?|ville?|vendita)(?:\/|[-_0-9])/i.test(u.pathname)||/\/\d{6,}(?:\/|$)/.test(u.pathname);
        const score=tracker?5:detail?250:u.pathname.length>1?100:50;
        found.push({url:u.toString(),score});
        break;
      }
      const nested=["url","target","dest","destination","redirect","redirect_url","adurl","u","q"].map(k=>u.searchParams.get(k)).find(Boolean);
      if(!nested)break;try{u=new URL(nested,u);}catch{break;}
    }
  }catch{}}
  found.sort((a,b)=>b.score-a.score);
  return found[0]?.url||null;
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
export async function resolveListingUrl(s:string):Promise<string|null> {
  const candidate=listingUrl(s);
  if(!candidate)return null;
  try{
    const initial=new URL(candidate);
    const host=initial.hostname.toLowerCase().replace(/^www\./,"");
    const tracked=/^(?:click|clicks|tracking|track|redirect|links?)\./i.test(host)||/\/(?:f\/a|track|click|redirect)\//i.test(initial.pathname);
    if(!tracked)return candidate;
    const response=await fetch(candidate,{
      method:"HEAD",redirect:"follow",signal:AbortSignal.timeout(3500)
    });
    const finalUrl=new URL(response.url||candidate);
    const finalHost=finalUrl.hostname.toLowerCase().replace(/^www\./,"");
    if(PORTALS.some(d=>finalHost===d||finalHost.endsWith("."+d))&&!/^(?:click|clicks|tracking|track|redirect|links?)\./i.test(finalHost)){
      return finalUrl.toString();
    }
  }catch{}
  return candidate;
}
export function sellerClassification(value:string):"Privato"|"Da verificare"|"Agenzia" {
  const text=String(value||"").toLocaleLowerCase("it");
  const agencyPatterns=[
    /(?:venditore|inserzionista|proposto da|pubblicato da|annuncio di|a cura di)\s*[:\-]?\s*(?:un[ao]?\s+)?(?:agenzia(?:\s+immobiliare)?|agente immobiliare|professionista)\b/i,
    /\bda\s+(?:un[ao]?\s+)?agenzia(?:\s+immobiliare)?\b/i,
    /\bagenzia immobiliare\b.{0,100}\bpropone\b/i,
    /\bproposto da\s+[A-ZÀ-Ý][\wÀ-ÿ'’.-]+\s+immobiliare\b/i
  ];
  if(agencyPatterns.some(pattern=>pattern.test(text)))return "Agenzia";
  const privatePatterns=[
    /\bda\s+privato\b/i,
    /\bvenditore\s*[:\-]?\s*privato\b/i,
    /\binserzionista\s*[:\-]?\s*privato\b/i,
    /\bpubblicato\s+da\s+privato\b/i,
    /\bannuncio\s+privato\b/i,
    /\bvendita\s+tra\s+privati\b/i,
    /\bprivato\s+(?:vende|propone)\b/i,
    /\bsenza\s+agenzia\b/i
  ];
  return privatePatterns.some(pattern=>pattern.test(text))?"Privato":"Da verificare";
}
