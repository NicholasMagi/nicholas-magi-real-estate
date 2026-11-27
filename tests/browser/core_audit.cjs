// Audit nel browser di Panoramica, Opportunità e Archivio, con Supabase simulato:
// - ogni voce di navigazione apre la propria sezione;
// - nessun pulsante visibile senza un gestore (verificato con il protocollo di debug di Chromium);
// - i numeri della Panoramica corrispondono ai dati simulati;
// - la ricerca dell'Archivio trova via, contatto collegato e numeri in formati diversi;
// - nessun errore JavaScript.
// Uso: node -r ./tests/browser/serve_from_disk.cjs tests/browser/core_audit.cjs tests/browser/stubs
const {chromium,devices}=require('playwright');const fs=require('fs');const dir=process.argv[2];
let failures=0;const check=(n,ok,d)=>{console.log((ok?"ok   ":"FAIL ")+n+(d!==undefined&&!ok?" — "+JSON.stringify(d):""));if(!ok)failures++;};
(async()=>{const b=await chromium.launch();
 for(const [label,opts] of [["desktop",{viewport:{width:1366,height:900}}],["smartphone",{...devices["iPhone 13"]}]]){
 const ctx=await b.newContext(opts);const p=await ctx.newPage();
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await ctx.addInitScript(()=>{localStorage.setItem('nmre-supabase-url','https://stub.supabase.co');localStorage.setItem('nmre-supabase-publishable-key','sb_publishable_stub');});
 await p.route('**/@supabase/supabase-js@2/+esm',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(dir+'/audit.js','utf8')}));
 await p.route(/unpkg\.com|nominatim|cruscotto|stub\.supabase\.co/,r=>r.abort());
 await p.goto('http://127.0.0.1:8765/index.html');await p.waitForTimeout(3000);
 const cdp=await ctx.newCDPSession(p);
 async function listenersAt(expr){
  const {result}=await cdp.send('Runtime.evaluate',{expression:expr});
  if(!result.objectId)return [];
  const {listeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:result.objectId,depth:0});
  return listeners.map(l=>l.type);
 }
 async function deadButtons(sectionSelector){
  const infos=await p.$$eval(sectionSelector+' button, '+sectionSelector+' a[href="#"]',els=>els.filter(el=>el.getClientRects().length).map((el,i)=>{
   el.setAttribute('data-audit-idx',String(i));
   let depth=0;for(let n=el;n&&n!==document.body;n=n.parentElement)depth++;
   return {i,depth,text:(el.innerText||el.getAttribute('aria-label')||el.title||'').trim().replace(/\s+/g,' ').slice(0,60),id:el.id,type:el.getAttribute('type'),inForm:!!el.closest('form')};
  }));
  const dead=[];
  for(const info of infos){
   if(info.inForm&&(info.type===null||info.type==='submit'))continue;
   let found=false;
   for(let up=0;up<info.depth&&!found;up++){
    const types=await listenersAt('(()=>{let n=document.querySelector(\'[data-audit-idx="'+info.i+'"]\');for(let k=0;k<'+up+';k++)n=n&&n.parentElement;return n;})()');
    if(types.some(t=>['click','pointerdown','mousedown','touchstart','pointerup','mouseup'].includes(t)))found=true;
   }
   if(!found)dead.push(info);
  }
  await p.$$eval('[data-audit-idx]',els=>els.forEach(el=>el.removeAttribute('data-audit-idx')));
  return {total:infos.length,dead};
 }
 const open=async view=>{await p.evaluate(v=>document.querySelector('[data-nmre-nav="'+v+'"]').click(),view);await p.waitForTimeout(700);};

 // 1. Navigazione
 const views=await p.$$eval('[data-nmre-nav]',els=>[...new Set(els.map(e=>e.dataset.nmreNav))]);
 const hidden=[];
 for(const v of views){await open(v);if(!await p.evaluate(v=>{const el=document.getElementById(v);return !!el&&!!el.getClientRects().length;},v))hidden.push(v);}
 check(label+": ognuna delle "+views.length+" voci di navigazione apre la sua sezione",hidden.length===0&&views.length>=10,hidden);

 // 2. Numeri della Panoramica (dati simulati: 2 candidati in coda, 2 immobili attivi in Archivio da contattare)
 await open("dashboard");
 const n=await p.evaluate(()=>({candidates:document.querySelector('#dashCandidates').textContent,toCall:document.querySelector('#dashToCall').textContent,mandates:document.querySelector('#dashMandates').textContent}));
 check(label+": Panoramica · opportunità in coda (agenzie escluse dalla coda)",n.candidates==="2",n);
 check(label+": Panoramica · da contattare (cestino escluso)",n.toCall==="2",n);
 check(label+": Panoramica · incarichi",n.mandates==="0",n);

 // 3. Pulsanti senza gestore
 for(const [view,sel] of [["dashboard","#dashboard"],["candidateSection","#candidateSection"],["archiveSection","#archiveSection"]]){
  await open(view);const r=await deadButtons(sel);
  check(label+": "+view+" · nessuno dei "+r.total+" pulsanti visibili è privo di funzione",r.dead.length===0&&r.total>0,r.dead);
 }

 // 4. Ricerca dell'Archivio
 await open("archiveSection");
 const search=async term=>{await p.fill('#listingSearch',term);await p.dispatchEvent('#listingSearch','input');await p.waitForTimeout(400);
  return p.evaluate(()=>document.querySelector('#listingFilterCount').textContent);};
 check(label+": Archivio · ricerca per via",/^1 risultati/.test(await search("via roma")),await search("via roma"));
 check(label+": Archivio · ricerca per numero senza spazi",/^1 risultati/.test(await search("3331234567")),await search("3331234567"));
 check(label+": Archivio · ricerca per numero con +39",/^1 risultati/.test(await search("+39 333 123 4567")),await search("+39 333 123 4567"));
 check(label+": Archivio · nessun risultato inventato",/^0 risultati/.test(await search("palermo")),await search("palermo"));
 check(label+": Archivio · cestino escluso dall'elenco",/su 2 immobili/.test(await search("")),await search(""));

 check(label+": nessun errore JavaScript",errors.length===0,errors);
 await ctx.close();
 }
 await b.close();console.log(failures?failures+" controlli non superati":"Tutti i controlli superati");process.exit(failures?1:0);})();
