// Punto 1: uno storico notifiche parziale non viene mai salvato come caricamento completo.
const {chromium}=require('playwright');const fs=require('fs');const dir=process.argv[2];
const results=[];let failures=0;
function check(name,ok,detail){results.push((ok?"ok   ":"FAIL ")+name+(detail!==undefined?" — "+JSON.stringify(detail):""));if(!ok)failures++;}
(async()=>{
  const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1366,height:900}});const p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(()=>{localStorage.setItem('nmre-supabase-url','https://stub.supabase.co');localStorage.setItem('nmre-supabase-publishable-key','sb_publishable_stub');});
  await p.route('**/@supabase/supabase-js@2/+esm',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(dir+'/recovery.js','utf8')}));
  await p.route(/unpkg\.com|nominatim|cruscotto|stub\.supabase\.co/,r=>r.abort());
  p.on('dialog',d=>d.accept(d.type()==='prompt'?'Motivo di prova':undefined));
  await p.goto('http://127.0.0.1:8765/index.html?nodubious=1');await p.waitForTimeout(2000);
  await p.evaluate(()=>document.querySelector('[data-nmre-nav="candidateSection"]').click());await p.waitForTimeout(400);
  const state=()=>p.evaluate(()=>({
    error:document.querySelector('[data-recovery-error]')?.innerText||null,
    cards:document.querySelectorAll('#candidateRecoveryList [data-recovery-item]').length,
    d5:document.querySelector('[data-recovery-item="d5"]')?.innerText.match(/Notifiche ricevute in totale: \d+/)?.[0]||null,
    retry:!!document.querySelector('#candidateRecoveryRetry'),
    msg:document.querySelector('#candidateMsg').textContent}));
  // A) primo caricamento: la seconda pagina dello storico (oltre 1000 notifiche) fallisce
  await p.evaluate(()=>{window.__failRecoveryAfter=1;document.querySelector('#candidateRecoveryPanel').open=true;});await p.waitForTimeout(1200);
  let s=await state();
  check("A · errore a metà storico: nessuna scheda mostrata come completa",s.cards===0&&s.d5===null,s);
  check("A · errore visibile con «Riprova»",!!s.error&&/non caricati/.test(s.error)&&s.retry,s.error);
  await p.click('#candidateRecoveryRetry');await p.waitForTimeout(1200);
  s=await state();
  check("A · «Riprova»: caricamento completo, storico intero (1500)",s.cards>0&&s.d5==="Notifiche ricevute in totale: 1500"&&!s.error,s);
  // B) con una cache valida: un nuovo caricamento fallisce a metà
  await p.evaluate(()=>{const r=window.__db.annunci_candidati.find(x=>x.id==="d5");window.__db.annunci_candidati_notifiche.push({candidate_id:"d5",source_email_id:"nuova",notified_at:"2026-11-25T00:00:00Z",created_at:"2026-11-25T00:00:00Z",listing_price:98000});window.__failRecoveryAfter=1;});
  await p.click('#refreshCandidates');await p.waitForTimeout(1200);
  s=await state();
  check("B · errore con cache valida: resta l'ultimo caricamento completo (1500, non un parziale)",s.cards>0&&s.d5==="Notifiche ricevute in totale: 1500",s.d5);
  check("B · avviso «Dati non aggiornati» con data dell'ultimo caricamento e «Riprova»",!!s.error&&/Dati non aggiornati/.test(s.error)&&/ultimo caricamento completo/.test(s.error)&&s.retry,s.error);
  await p.click('#candidateRecoveryRetry');await p.waitForTimeout(1200);
  s=await state();
  check("B · «Riprova»: dati aggiornati (1501) e avviso rimosso",s.d5==="Notifiche ricevute in totale: 1501"&&!s.error,s);
  // C) pannello chiuso + aggiornamento forzato: la cache valida non viene svuotata
  await p.evaluate(()=>{document.querySelector('#candidateRecoveryPanel').open=false;});await p.waitForTimeout(200);
  await p.click('#refreshCandidates');await p.waitForTimeout(800);
  await p.evaluate(()=>{window.__failRecoveryAfter=0;document.querySelector('#candidateRecoveryPanel').open=true;});await p.waitForTimeout(1200);
  s=await state();
  check("C · riapertura con errore dopo un aggiornamento forzato: la cache valida resta visibile",s.cards>0&&s.d5==="Notifiche ricevute in totale: 1501"&&/Dati non aggiornati/.test(s.error||""),s);
  check("nessun errore JavaScript",errors.length===0,errors);
  await b.close();
  console.log(results.join("\n"));console.log(failures?failures+" controlli non superati":"Tutti i controlli superati ("+results.length+")");process.exit(failures?1:0);
})();
