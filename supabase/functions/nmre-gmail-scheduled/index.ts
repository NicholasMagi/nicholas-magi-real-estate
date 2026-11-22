import {
  municipality,price,listingUrl,propertyEmail,listingTitle,propertyType,
  surface,rooms,bedrooms,bathrooms,resolveListingUrl,sellerClassification
} from "./_shared/parser.ts";

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