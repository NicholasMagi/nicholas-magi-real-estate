import { withSupabase } from "npm:@supabase/server@^1";

const ACCOUNT = "nicholasmagirealestate@gmail.com";
const PORTALS = ["idealista.it","immobiliare.it","casa.it","subito.it","green-acres.it","green-acres.com","gate-away.com","trovacasa.it","wikicasa.it"];
const TOWNS = ["Porto Sant'Elpidio","Porto Recanati","Porto San Giorgio","Civitanova Marche","Falconara Marittima","Santa Maria Nuova","Maiolati Spontini","Monte San Vito","Monte Urano","Monte Roberto","Montecassiano","Morro d'Alba","Montemarciano","Castelfidardo","Ancona","Osimo","Loreto","Recanati","Camerano","Numana","Sirolo","Jesi","Macerata","Fermo","Senigallia","Filottrano","Polverigi","Agugliano","Offagna","Chiaravalle","Ostra","Tolentino","Staffolo","Cupramontana","Monsano","Trecastelli","Corridonia","Montegranaro"];

function b64(bytes: Uint8Array): string { let s=""; for(const x of bytes)s+=String.fromCharCode(x); return btoa(s); }
function unb64(s: string): Uint8Array { return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
async function key(secret: string): Promise<CryptoKey> {
  const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw",d,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function decrypt(value: string, secret: string): Promise<Record<string,unknown>> {
  const p=value.split("."); if(p.length!==3||p[0]!=="v1")throw new Error("Formato token cifrato non valido");
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(p[1])},await key(secret),unb64(p[2]));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function encrypt(value: Record<string,unknown>, secret: string): Promise<string> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},await key(secret),new TextEncoder().encode(JSON.stringify(value)));
  return "v1."+b64(iv)+"."+b64(new Uint8Array(cipher));
}
async function accessToken(tokens: Record<string,unknown>, expiresAt: string, secret: string, admin: any): Promise<string> {
  const refresh=tokens.refresh_token;
  if(typeof refresh!=="string"||!refresh)throw new Error("Refresh token non disponibile");
  if(new Date(expiresAt).getTime()>Date.now()+60000&&typeof tokens.access_token==="string")return tokens.access_token;
  const id=Deno.env.get("GOOGLE_CLIENT_ID"), clientSecret=Deno.env.get("GOOGLE_CLIENT_SECRET");
  if(!id||!clientSecret)throw new Error("Configurazione Google incompleta");
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:id,client_secret:clientSecret,refresh_token:refresh,grant_type:"refresh_token"})});
  if(!response.ok)throw new Error("Rinnovo del token Google non riuscito");
  const fresh=await response.json(); if(!fresh.access_token)throw new Error("Token Google mancante");
  const updated={...tokens,access_token:fresh.access_token,refresh_token:refresh,token_type:fresh.token_type||"Bearer",scope:fresh.scope||tokens.scope||""};
  const expiry=new Date(Date.now()+Number(fresh.expires_in||3600)*1000).toISOString();
  const ciphertext=await encrypt(updated,secret);
  const {error}=await admin.rpc("nmre_save_gmail_tokens",{p_email:ACCOUNT,p_token_ciphertext:ciphertext,p_scope:String(updated.scope||""),p_expires_at:expiry});
  if(error)throw new Error("Aggiornamento token Gmail non riuscito");
  return fresh.access_token;
}
function decode(s: string): string {
  const n=s.replace(/-/g,"+").replace(/_/g,"/"); const padded=n+"=".repeat((4-n.length%4)%4);
  const bin=atob(padded); return new TextDecoder("utf-8",{fatal:false}).decode(Uint8Array.from(bin,c=>c.charCodeAt(0)));
}
function bodyParts(part: any): string[] {
  const out:string[]=[];
  if(part?.body?.data&&part.mimeType==="text/plain")out.push(decode(part.body.data));
  else if(part?.body?.data&&part.mimeType==="text/html"){
    const html=decode(part.body.data).replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi," ").replace(/<\s*a\b[^>]*href=["']([^"']+)["'][^>]*>/gi," $1 ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">");
    out.push(html);
  }
  for(const child of part?.parts||[])out.push(...bodyParts(child));
  return out;
}
function municipality(s:string):string|null {
  const n=" "+String(s||"").toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]+/gu," ")+" ";
  return TOWNS.find(t=>n.includes(" "+t.toLocaleLowerCase("it")+" "))||null;
}
function price(s:string):number|null {
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
function propertyType(s:string):string|null {
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
function surface(s:string):number|null {
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
function rooms(s:string):number|null {
  const match=String(s||"").match(/\b([1-9]\d?(?:[.,]\d)?)\s*(?:locali|vani)\b/i);
  if(!match)return null;
  const value=Number(match[1].replace(",","."));
  return Number.isFinite(value)&&value>0&&value<=100?value:null;
}
function bedrooms(s:string):number|null {
  const match=String(s||"").match(/\b(\d{1,2})\s*(?:camere(?: da letto)?|camera(?: da letto)?)\b|\b(?:camere(?: da letto)?|camera(?: da letto)?)\s*[:\-]?\s*(\d{1,2})\b/i);
  const value=match?Number(match[1]||match[2]):null;
  return value!==null&&value>=0&&value<=20?value:null;
}
function bathrooms(s:string):number|null {
  const match=String(s||"").match(/\b(\d{1,2})\s*(?:bagni|bagno)\b|\b(?:bagni|bagno)\s*[:\-]?\s*(\d{1,2})\b/i);
  const value=match?Number(match[1]||match[2]):null;
  return value!==null&&value>=0&&value<=20?value:null;
}
function listingUrl(s:string):string|null {
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
function propertyEmail(e:any):boolean {
  const subject=String(e.subject||"").toLocaleLowerCase("it");
  const text=[e.subject,e.snippet,e.bodyText].filter(Boolean).join(" ").toLocaleLowerCase("it");
  const excluded=/(verifica il tuo indirizzo|verifica la tua email|hai condiviso alcuni dati|account google|benvenuto|ben arrivato|richiesta di contatto di recupero|ricerca (?:è stata )?salvata|password|reimposta|newsletter|promozion[ei]|subitopiù|attiva il tuo account|conferma il tuo indirizzo|asta giudiziaria|annuncio all['’]asta|\ball['’]asta\b|\baste immobiliari\b|\btribunale\b|\bvendi\s+all['’]asta\b|\bpiena proprietà\s+all['’]asta\b)/i;
  if(excluded.test(subject)||excluded.test(text))return false;
  const alertPattern=/(?:\b\d+\s+)?nuov[oi]\s+(?:annunci[oi]?|immobili|case|appartamenti|ville|proprietà)\b|annunci?\s+(?:appena )?pubblicat[oi]|nuov[oi]\s+immobil[ei]|nuov[ae]\s+proprietà|annuncio.{0,100}(?:tua ricerca|vendita|immobiliare)/i;
  if(!alertPattern.test(subject)&&!alertPattern.test(text.slice(0,5000)))return false;
  return !!listingUrl(text);
}
function listingTitle(e:any):string {
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
async function resolveListingUrl(s:string):Promise<string|null> {
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
function sellerClassification(value:string):"Privato"|"Da verificare"|"Agenzia" {
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
async function readEmail(m:any,token:string):Promise<any|null>{
  const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/"+encodeURIComponent(m.id)+"?format=full",{headers:{Authorization:"Bearer "+token}});
  if(!r.ok)return null; const e=await r.json(); const h=e.payload?.headers||[];
  const get=(n:string)=>h.find((x:any)=>x.name?.toLowerCase()===n.toLowerCase())?.value||"";
  return {id:e.id,from:get("From"),subject:get("Subject"),date:get("Date"),snippet:(e.snippet||"").slice(0,500),bodyText:bodyParts(e.payload).join("\n").slice(0,8000)};
}

export default {
  fetch: withSupabase({auth:"secret"},async(req,ctx)=>{
    if(req.method!=="POST")return Response.json({error:"Metodo non consentito"},{status:405});
    try{
      const owner=Deno.env.get("NMRE_ALLOWED_USER_ID"), encryptionSecret=Deno.env.get("INTEGRATION_TOKEN_ENCRYPTION_KEY");
      if(!owner||!/^[0-9a-f-]{36}$/i.test(owner)||!encryptionSecret)throw new Error("Configurazione server incompleta");
      const {data,error}=await ctx.supabaseAdmin.rpc("nmre_get_gmail_tokens");
      if(error||!data?.[0]?.token_ciphertext)throw new Error("Collegamento Gmail non trovato");
      if(data[0].email?.toLowerCase()!==ACCOUNT)throw new Error("Casella Gmail non autorizzata");
      const tokens=await decrypt(data[0].token_ciphertext,encryptionSecret);
      const token=await accessToken(tokens,data[0].expires_at,encryptionSecret,ctx.supabaseAdmin);
      const listResponse=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=newer_than%3A30d",{headers:{Authorization:"Bearer "+token}});
      if(!listResponse.ok)throw new Error("Lettura Gmail non riuscita");
      const list=await listResponse.json(), messages=list.messages||[], emails:Array<any|null>=[];
      for(let i=0;i<messages.length;i+=5)emails.push(...await Promise.all(messages.slice(i,i+5).map((m:any)=>readEmail(m,token))));
      const propertyEmails=emails.filter((e):e is any=>!!e&&propertyEmail(e));
      const classifiedAll=propertyEmails.map(e=>{
        const t=[e.subject,e.snippet,e.bodyText].filter(Boolean).join(" ");
        const seller=sellerClassification(t);
        return {email:e,text:t,seller};
      });
      const classified=classifiedAll.filter(x=>x.seller!=="Agenzia");
      const retainedIds=new Set(classified.map(x=>String(x.email.id)));
      const discardedKeys=emails.filter((e):e is any=>!!e&&!retainedIds.has(String(e.id)))
        .map(e=>"gmail:"+String(e.id));
      let discardedExisting=0;
      if(discardedKeys.length){
        const {data:discarded,error:discardError}=await ctx.supabaseAdmin.from("annunci_candidati")
          .update({
            stato:"scartato",notification_sender:null,email_subject:null,
            updated_at:new Date().toISOString()
          })
          .eq("owner_id",owner).eq("stato","da_verificare")
          .in("dedup_key",discardedKeys).select("id");
        if(discardError)throw new Error("Pulizia delle notifiche non pertinenti non riuscita");
        discardedExisting=discarded?.length||0;
      }
      const rows=await Promise.all(classified.map(async({email:e,text:t,seller})=>{
        const url=await resolveListingUrl(t);
        let portal:string|null=null;
        try{
          if(url){
            const host=new URL(url).hostname.toLowerCase().replace(/^www\./,"");
            portal=PORTALS.find(d=>host===d||host.endsWith("."+d))||null;
          }
        }catch{portal=null;}
        return {
          owner_id:owner,titolo:listingTitle(e),comune:municipality(t),prezzo:price(t),
          tipologia_immobile:propertyType(t),superficie_mq:surface(t),locali:rooms(t),
          camere:bedrooms(t),bagni:bathrooms(t),tipo_venditore:seller,
          portale:portal||"Portale non indicato",url,
          data_pubblicazione:e.date&&!Number.isNaN(Date.parse(e.date))?new Date(e.date).toISOString():null,
          source_email_id:String(e.id),dedup_key:"gmail:"+String(e.id),stato:"da_verificare"
        };
      }));
      let inserted=0,updated=0;
      for(const row of rows){
        const {data:existing,error:updateError}=await ctx.supabaseAdmin.from("annunci_candidati")
          .update({
            titolo:row.titolo,comune:row.comune,prezzo:row.prezzo,
            tipo_venditore:row.tipo_venditore,portale:row.portale,url:row.url,
            data_pubblicazione:row.data_pubblicazione,
            tipologia_immobile:row.tipologia_immobile,
            superficie_mq:row.superficie_mq,locali:row.locali,camere:row.camere,bagni:row.bagni,
            notification_sender:null,email_subject:null,
            updated_at:new Date().toISOString()
          })
          .eq("owner_id",owner).eq("dedup_key",row.dedup_key).eq("stato","da_verificare")
          .select("id");
        if(updateError)throw new Error("Aggiornamento degli annunci candidati non riuscito");
        updated+=existing?.length||0;
      }
      if(rows.length){
        const {data:saved,error:saveError}=await ctx.supabaseAdmin.from("annunci_candidati")
          .upsert(rows,{onConflict:"owner_id,dedup_key",ignoreDuplicates:true}).select("id");
        if(saveError)throw new Error("Salvataggio annunci candidati non riuscito");
        inserted=saved?.length||0;
      }
      const excludedAgencies=propertyEmails.length-classified.length;
      return Response.json({
        success:true,account:ACCOUNT,listed:messages.length,read:emails.filter(Boolean).length,
        propertyNotifications:propertyEmails.length,privateRecognized:rows.filter(r=>r.tipo_venditore==="Privato").length,
        needsUserReview:rows.filter(r=>r.tipo_venditore==="Da verificare").length,
        excludedAgencies,discardedExisting,inserted,updated,
        duplicatesOrExisting:Math.max(0,rows.length-inserted-updated),
        failed:emails.filter(x=>!x).length
      });
    }catch(error){
      console.error("Errore Gmail scheduled reader:",error instanceof Error?error.message:"Errore sconosciuto");
      return Response.json({success:false,error:error instanceof Error?error.message:"Errore sincronizzazione Gmail"},{status:500});
    }
  })
};