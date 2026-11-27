// Supabase simulato per i test del pannello di recupero (nessuna rete reale).
// Riproduce: proiezione delle colonne con alias e percorsi JSON, filtri, ordinamento,
// paginazione con limite del server (max-rows 1000), update con .select(), errore PGRST205.
const params=new URLSearchParams(location.search);
const missingDubious=params.has("nodubious");
const MAX_ROWS=1000;
const now=new Date().toISOString();
const iso=offsetMin=>new Date(Date.now()+offsetMin*60000).toISOString();
const rows={annunci_candidati:[
 ...[{"id":"s0","created_at":"2026-11-26T08:30:00Z","updated_at":"2026-11-26T08:30:00Z","seller_manual_override":false,"owner_id":"u1","titolo":"Trilocale con balcone zona Adriatico","comune":"Ancona","prezzo":165000,"tipologia_immobile":"Trilocale","superficie_mq":85,"locali":3,"camere":null,"bagni":null,"dati_estratti":{"riscaldamento":"autonomo","dotazioni_rilevate":["cantina"],"riduzione_prezzo":null,"campi_immobile":{"titolo":"Trilocale con balcone zona Adriatico","comune":"Ancona","prezzo":165000,"tipologia":"Trilocale","superficie_mq":85,"locali":3,"camere":null,"bagni":null},"subito":{"id":"608812345","url":"https://www.subito.it/appartamenti/trilocale-con-balcone-zona-adriatico-ancona-608812345.htm","pubblicato_il":"2026-11-26T06:58:10.000Z","descrizione":"Privato vende trilocale con balcone e cantina, riscaldamento autonomo, secondo piano.","immagini":["https://images.sbito.it/api/v1/sbt-ads-images-pro/images/45/608812345-0","https://images.sbito.it/api/v1/sbt-ads-images-pro/images/45/608812345-1"],"inserzionista_professionale":false,"ricerca":"subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2","url_ricerca":"https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc","fonte_dati":"next_data","dettagli_completi":true}},"dati_fonte":{"provider":"Gmail · Subito ricerca salvata","source_email_id":"19a1f0c2d3e4b5a6","received_at":"2026-11-26T08:24:26.000Z","sender":"Subito <noreply@subito.it>","subject":"Appartamenti a Ancona e provincia ha 3 nuovi annunci per te","ricerca_subito":"subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2","url_ricerca":"https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc","annunci_dichiarati":3,"captured_at":"2026-11-26T10:00:00Z"},"data_extraction_version":6,"tipo_venditore":"Privato","seller_confidence":94,"seller_evidence":"Vendita dichiarata direttamente dal proprietario","seller_classification_version":3,"notification_sender":"Subito <noreply@subito.it>","email_subject":"Appartamenti a Ancona e provincia ha 3 nuovi annunci per te","portale":"subito.it","url":"https://www.subito.it/appartamenti/trilocale-con-balcone-zona-adriatico-ancona-608812345.htm","url_originale":"https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc","data_pubblicazione":"2026-11-26T08:24:26.000Z","source_email_id":"19a1f0c2d3e4b5a6#subito-608812345","dedup_key":"subito:608812345","listing_key":"subito.it/appartamenti/trilocale-con-balcone-zona-adriatico-ancona-608812345.htm","deduplication_version":1,"stato":"da_verificare"},{"id":"s1","created_at":"2026-11-26T08:30:00Z","updated_at":"2026-11-26T08:30:00Z","seller_manual_override":false,"owner_id":"u1","titolo":"Quadrilocale ristrutturato Pinocchio","comune":"Ancona","prezzo":219000,"tipologia_immobile":"Quadrilocale","superficie_mq":110,"locali":4,"camere":null,"bagni":null,"dati_estratti":{"stato_immobile":"ristrutturato","dotazioni_rilevate":["posto auto"],"riduzione_prezzo":null,"campi_immobile":{"titolo":"Quadrilocale ristrutturato Pinocchio","comune":"Ancona","prezzo":219000,"tipologia":"Quadrilocale","superficie_mq":110,"locali":4,"camere":null,"bagni":null},"subito":{"id":"608807711","url":"https://www.subito.it/appartamenti/quadrilocale-ristrutturato-pinocchio-ancona-608807711.htm","pubblicato_il":"2026-11-25T20:14:02.000Z","descrizione":"Quadrilocale ristrutturato a nuovo, due bagni, posto auto.","immagini":["https://images.sbito.it/api/v1/sbt-ads-images-pro/images/11/608807711-0","https://images.sbito.it/api/v1/sbt-ads-images-pro/images/11/608807711-1"],"inserzionista_professionale":false,"ricerca":"subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2","url_ricerca":"https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc","fonte_dati":"next_data","dettagli_completi":true}},"dati_fonte":{"provider":"Gmail · Subito ricerca salvata","source_email_id":"19a1f0c2d3e4b5a6","received_at":"2026-11-26T08:24:26.000Z","sender":"Subito <noreply@subito.it>","subject":"Appartamenti a Ancona e provincia ha 3 nuovi annunci per te","ricerca_subito":"subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2","url_ricerca":"https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc","annunci_dichiarati":3,"captured_at":"2026-11-26T10:00:00Z"},"data_extraction_version":6,"tipo_venditore":"Da verificare","seller_confidence":0,"seller_evidence":"Nessuna indicazione affidabile sul tipo di venditore nell'email","seller_classification_version":3,"notification_sender":"Subito <noreply@subito.it>","email_subject":"Appartamenti a Ancona e provincia ha 3 nuovi annunci per te","portale":"subito.it","url":"https://www.subito.it/appartamenti/quadrilocale-ristrutturato-pinocchio-ancona-608807711.htm","url_originale":"https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc","data_pubblicazione":"2026-11-26T08:24:26.000Z","source_email_id":"19a1f0c2d3e4b5a6#subito-608807711","dedup_key":"subito:608807711","listing_key":"subito.it/appartamenti/quadrilocale-ristrutturato-pinocchio-ancona-608807711.htm","deduplication_version":1,"stato":"da_verificare"},{"id":"sd","created_at":"2026-11-26T08:30:00Z","updated_at":"2026-11-26T08:30:00Z","seller_manual_override":false,"owner_id":"u1","titolo":"Ricerca salvata Subito · Appartamenti a Ancona e provincia · 3 nuovi annunci da verificare","comune":null,"prezzo":null,"tipologia_immobile":null,"superficie_mq":null,"locali":null,"camere":null,"bagni":null,"dati_estratti":{"riduzione_prezzo":null,"campi_immobile":{},"ricerca_subito":{"stato":"da_verificare","motivo":"nessuna_notifica_precedente","testo":"Prima email di questa ricerca acquisita da NMRE: non si sa da quando contare i nuovi annunci","annunci_dichiarati":3,"annunci_nella_pagina":8,"annunci_in_finestra":null,"fonte_pagina":"next_data","url_ricerca":"https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc","link_non_riconosciuto":null,"chiave":"subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2","tentativi":1,"nuovo_tentativo":false,"ultimo_tentativo":"2026-11-26T10:00:00Z","possibili":[{"id":"608812345","url":"https://www.subito.it/appartamenti/trilocale-con-balcone-zona-adriatico-ancona-608812345.htm","titolo":"Trilocale con balcone zona Adriatico","prezzo":165000,"localita":"Ancona","pubblicato_il":"2026-11-26T06:58:10.000Z"},{"id":"608807711","url":"https://www.subito.it/appartamenti/quadrilocale-ristrutturato-pinocchio-ancona-608807711.htm","titolo":"Quadrilocale ristrutturato Pinocchio","prezzo":219000,"localita":"Ancona","pubblicato_il":"2026-11-25T20:14:02.000Z"},{"id":"608799020","url":"https://www.subito.it/appartamenti/bilocale-arredato-centro-falconara-marittima-608799020.htm","titolo":"Bilocale arredato centro","prezzo":98000,"localita":"Falconara Marittima","pubblicato_il":"2026-11-25T17:40:55.000Z"},{"id":"608701234","url":"https://www.subito.it/appartamenti/appartamento-con-garage-osimo-608701234.htm","titolo":"Appartamento con garage","prezzo":175000,"localita":"Osimo","pubblicato_il":"2026-11-24T15:02:11.000Z"}],"recuperati":[]}},"dati_fonte":{"provider":"Gmail · Subito ricerca salvata","source_email_id":"19a0aa11bb22cc33","received_at":"2026-11-26T08:24:26.000Z","sender":"Subito <noreply@subito.it>","subject":"Appartamenti a Ancona e provincia ha 3 nuovi annunci per te","ricerca_subito":"subito.it/annunci-marche/vendita/appartamenti/ancona?advt=0,2","url_ricerca":"https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc","annunci_dichiarati":3,"captured_at":"2026-11-26T10:00:00Z"},"data_extraction_version":6,"tipo_venditore":"Da verificare","seller_confidence":0,"seller_evidence":"Email riepilogativa di una ricerca salvata Subito: non riguarda un singolo annuncio","seller_classification_version":3,"notification_sender":"Subito <noreply@subito.it>","email_subject":"Appartamenti a Ancona e provincia ha 3 nuovi annunci per te","portale":"subito.it","url":null,"url_originale":"https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc","data_pubblicazione":"2026-11-26T08:24:26.000Z","source_email_id":"19a0aa11bb22cc33","dedup_key":"gmail:19a0aa11bb22cc33","listing_key":null,"deduplication_version":1,"stato":"da_verificare"}],
 {id:"q1",owner_id:"u1",stato:"da_verificare",tipo_venditore:"Da verificare",seller_manual_override:false,titolo:"Trilocale in coda",comune:"Ancona",prezzo:150000,portale:"immobiliare.it",url:"https://www.immobiliare.it/annunci/999999/",notification_sender:"a",email_subject:"b",source_email_id:"m1",created_at:now,updated_at:"2026-11-26T08:00:00.123456+00:00",data_pubblicazione:now,dati_estratti:{pagina_pubblica:{testo:"x".repeat(2000)}},dati_fonte:{}},
 {id:"g1",owner_id:"u1",stato:"da_verificare",tipo_venditore:"Agenzia",seller_manual_override:false,seller_evidence:"Venditore indicato come agenzia o professionista",titolo:"Agenzia automatica",comune:"Jesi",portale:"idealista.it",url:"https://www.idealista.it/immobile/7654321/",notification_sender:"a",email_subject:"b",source_email_id:"m2",created_at:"2026-11-20T09:00:00Z",updated_at:"2026-11-26T08:00:00.123456+00:00",data_pubblicazione:"2026-11-20T08:59:00Z",dati_estratti:{},dati_fonte:{}},
 {id:"r1",owner_id:"u1",stato:"da_verificare",tipo_venditore:"Da verificare",seller_manual_override:false,titolo:"Privato riaperto per ribasso",comune:"Ancona",prezzo:140000,portale:"immobiliare.it",url:"https://www.immobiliare.it/annunci/777777/",notification_sender:"a",email_subject:"Ribasso",source_email_id:"m7",created_at:"2026-11-01T00:00:00Z",updated_at:now,data_pubblicazione:now,dati_estratti:{storico_stato:[{data:"2026-11-10T10:00:00Z",origine:"utente",azione:"scartato",motivo:"Prezzo alto"},{data:now,origine:"sincronizzazione",azione:"riaperto_per_ribasso",da:"scartato",a:"da_verificare",motivo:"Nuovo ribasso documentato (-7%)"}]},dati_fonte:{}},
 {id:"d1",owner_id:"u1",stato:"scartato",tipo_venditore:"Da verificare",seller_manual_override:false,titolo:"Scartato con nuova notifica",comune:"Ancona",url:"https://www.immobiliare.it/annunci/123456/",notification_sender:"x",email_subject:"y",source_email_id:"m3",created_at:"2026-11-01T00:00:00Z",updated_at:"2026-11-22T08:00:00.654321+00:00",dati_estratti:{pagina_pubblica:{testo:"y".repeat(2000)},storico_stato:[{data:"2026-11-20T10:00:00Z",origine:"utente",azione:"scartato",motivo:"Prezzo fuori zona"}],notifiche_dopo_scarto:{conteggio:1,da_rivedere:true,elenco:[{data:"2026-11-22T08:00:00Z",prezzo:160000,titolo:"Trilocale ripubblicato"}]}}},
 {id:"d4",owner_id:"u1",stato:"scartato",tipo_venditore:"Agenzia",seller_manual_override:false,seller_evidence:"Venditore indicato come agenzia o professionista",titolo:"Agenzia automatica storica",comune:"Loreto",url:"https://www.casa.it/immobili/48999999/",notification_sender:"x",email_subject:"y",source_email_id:"m5",created_at:"2026-11-03T00:00:00Z",updated_at:"2026-11-03T00:00:00Z",dati_estratti:{}},
 {id:"d5",owner_id:"u1",stato:"scartato",tipo_venditore:"Da verificare",seller_manual_override:false,titolo:"Scarto storico con molte notifiche",comune:"Senigallia",url:"https://www.idealista.it/immobile/3333333/",notification_sender:null,email_subject:null,source_email_id:"m9",created_at:"2026-10-01T00:00:00Z",updated_at:"2026-11-24T00:00:00Z",dati_estratti:{}}
],annunci_candidati_notifiche:[
 {candidate_id:"r1",source_email_id:"m7",notified_at:now,created_at:now,listing_price:140000,previous_price:150000,price_drop_percent:7},
 {candidate_id:"d1",source_email_id:"m3",notified_at:"2026-11-01T00:00:00Z",created_at:"2026-11-01T00:00:00Z",listing_price:160000},
 {candidate_id:"d1",source_email_id:"m6",notified_at:"2026-11-22T08:00:00Z",created_at:"2026-11-22T08:00:00Z",listing_price:160000,listing_title:"Trilocale ripubblicato"}
],nmre_gmail_avvisi_dubbi:[
 {id:"v1",owner_id:"u1",gmail_message_id:"g-1",rfc822_message_id:"<abc@portale>",ricevuto_il:now,regola_esclusione:"esclusione_nel_testo",prova:"scheda_specifica",portale:"immobiliare.it",link_annuncio:"https://www.immobiliare.it/annunci/555555/",oggetto:"Nuovo annuncio per la tua ricerca",stato:"da_verificare",created_at:now,updated_at:now}
]};
// 1500 notifiche per lo scarto storico d5 (oltre il limite di 1000 righe per richiesta)
for(let i=0;i<1500;i++)rows.annunci_candidati_notifiche.push({candidate_id:"d5",source_email_id:"n"+String(i).padStart(5,"0"),notified_at:new Date(Date.UTC(2026,8,1)+i*3600000).toISOString(),created_at:new Date(Date.UTC(2026,8,1)+i*3600000).toISOString(),listing_price:99000});
// ?big=1: 1100 scarti storici in più (paginazione a chiave e "Mostra altri")
if(params.has("big"))for(let i=0;i<1100;i++)rows.annunci_candidati.push({id:"z"+String(i).padStart(5,"0"),owner_id:"u1",stato:"scartato",tipo_venditore:"Da verificare",seller_manual_override:false,titolo:"Scarto storico "+i,comune:"Pesaro",url:"https://www.idealista.it/immobile/"+(5000000+i)+"/",notification_sender:null,email_subject:null,source_email_id:"zz"+i,created_at:"2026-09-01T00:00:00Z",updated_at:"2026-09-02T00:00:00Z",dati_estratti:{}});

window.__db=rows;window.__writes=[];window.__reads=[];window.__afterRead=null;
const clone=v=>JSON.parse(JSON.stringify(v));
function getPath(row,expr){ // "dati_estratti->a->>b"
  const parts=expr.split(/->>?/);let value=row[parts[0]];
  for(const key of parts.slice(1)){value=value&&typeof value==="object"?value[key]:undefined;}
  if(/->>/.test(expr)&&value!==undefined&&value!==null&&typeof value!=="string")value=typeof value==="object"?JSON.stringify(value):String(value);
  return value===undefined?null:value;
}
function project(row,select){
  if(!select||select.trim()==="*")return clone(row);
  const out={};
  for(const raw of select.split(",")){
    const item=raw.trim();if(!item)continue;
    const [alias,expr]=item.includes(":")?item.split(":"):[item.split(/->>?/).pop(),item];
    out[alias]=clone(getPath(row,expr)??null);
  }
  return out;
}
class Q{
  constructor(t){this.t=t;this.f=[];this.op="select";this.sel="*";this.orders=[];this.lim=null;this.rng=null;this.single=false;this.returning=false;}
  select(s="*"){if(this.op==="select")this.sel=s;else this.returning=true;return this}
  eq(c,v){this.f.push(r=>{const x=getPath(r,c);return x===v||(x!==null&&String(x)===String(v));});return this}
  neq(c,v){this.f.push(r=>getPath(r,c)!==v);return this}
  in(c,vs){this.f.push(r=>vs.map(String).includes(String(getPath(r,c))));return this}
  not(c,op,v){this.f.push(r=>getPath(r,c)!==null);return this}
  is(c,v){this.f.push(r=>(getPath(r,c)??null)===v);return this}
  gt(c,v){this.f.push(r=>String(getPath(r,c))>String(v));return this}
  gte(){return this} lte(){return this} ilike(){return this} or(){return this}
  order(c,o={}){this.orders.push([c,o.ascending!==false]);return this}
  limit(n){this.lim=n;return this}
  range(a,b){this.rng=[a,b];return this}
  maybeSingle(){this.single=true;return this}
  update(p){this.op="update";this.payload=p;return this}
  upsert(p){this.op="upsert";this.payload=p;return this}
  insert(p){this.op="insert";this.payload=p;return this}
  delete(){this.op="delete";return this}
  then(res,rej){try{
    window.__reads.push({t:this.t,op:this.op,sel:this.sel});
    if(this.t==="nmre_gmail_avvisi_dubbi"&&missingDubious){res({data:null,error:{code:"PGRST205",details:null,hint:null,message:"Could not find the table 'public.nmre_gmail_avvisi_dubbi' in the schema cache"},status:404});return;}
    // Guasto controllato: lo storico notifiche degli scartati fallisce dopo N letture riuscite.
    if(this.t==="annunci_candidati_notifiche"&&this.op==="select"&&!this.sel.includes("notification_sender")&&window.__failRecoveryAfter!==undefined){
      if(window.__failRecoveryAfter===0){window.__failRecoveryAfter=undefined;res({data:null,error:{code:"57014",message:"canceling statement due to statement timeout"}});return;}
      window.__failRecoveryAfter--;
    }
    const all=rows[this.t]||[];
    let m=all.filter(r=>this.f.every(f=>f(r)));
    if(this.op==="update"){
      m.forEach(r=>Object.assign(r,clone(this.payload)));
      window.__writes.push({table:this.t,payload:clone(this.payload),ids:m.map(r=>r.id)});
      res({data:this.returning?m.map(r=>({id:r.id})):null,error:null});return;
    }
    if(this.op!=="select"){window.__writes.push({table:this.t,op:this.op});res({data:[],error:null});return;}
    if(this.orders.length)m=m.slice().sort((a,b)=>{for(const [c,asc] of this.orders){const x=String(a[c]??""),y=String(b[c]??"");if(x!==y)return (x<y?-1:1)*(asc?1:-1);}return 0;});
    if(this.rng)m=m.slice(this.rng[0],this.rng[1]+1);
    if(this.lim!==null)m=m.slice(0,this.lim);
    m=m.slice(0,MAX_ROWS);
    const data=this.single?(m[0]?project(m[0],this.sel):null):m.map(r=>project(r,this.sel));
    // Simula una scrittura della sincronizzazione tra la lettura e l'aggiornamento del frontend.
    if(this.single&&this.t==="annunci_candidati"&&typeof window.__afterRead==="function"){const hook=window.__afterRead;window.__afterRead=null;hook(m[0]);}
    res({data,error:null});
  }catch(e){rej(e)}}
}
// Regole delle funzioni di sincronizzazione su un candidato esistente (nuova notifica
// classificata "Agenzia"): versione distribuita (main) e versione della PR.
window.__sync={
  deployed(id){const r=rows.annunci_candidati.find(x=>x.id===id);
    if(r.stato==="da_verificare"&&r.seller_manual_override!==true){r.tipo_venditore="Agenzia";r.seller_evidence="Venditore indicato come agenzia o professionista";}
    // scarto automatico delle agenzie: .eq("seller_manual_override", false)
    if(r.seller_manual_override===false&&r.tipo_venditore==="Agenzia")r.stato="scartato";
    r.updated_at=new Date().toISOString();return clone(r);},
  pr(id){const r=rows.annunci_candidati.find(x=>x.id===id);
    if(r.stato==="da_verificare"&&r.seller_manual_override!==true&&r.tipo_venditore!=="Agenzia"){r.tipo_venditore="Da verificare";r.seller_evidence="Nuovi segnali di agenzia: conferma manuale necessaria";}
    r.updated_at=new Date().toISOString();return clone(r);},
  notifyAfterDiscard(id,dateIso){const r=rows.annunci_candidati.find(x=>x.id===id);
    const m=r.dati_estratti.notifiche_dopo_scarto||{conteggio:0,elenco:[]};
    r.dati_estratti.notifiche_dopo_scarto={...m,conteggio:(m.conteggio||0)+1,elenco:[...(m.elenco||[]),{data:dateIso,prezzo:155000,titolo:"Nuova notifica"}],da_rivedere:true};
    rows.annunci_candidati_notifiche.push({candidate_id:id,source_email_id:"late-"+dateIso,notified_at:dateIso,created_at:dateIso,listing_price:155000,listing_title:"Nuova notifica"});
    r.updated_at=new Date().toISOString();}
};
export function createClient(){return {
  from:t=>new Q(t), rpc:async()=>({data:null,error:null}),
  functions:{invoke:async()=>({data:null,error:{message:"stub"}})},
  auth:{getSession:async()=>({data:{session:{user:{id:"u1",email:"test@example.com"}}},error:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
  channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}
};}
