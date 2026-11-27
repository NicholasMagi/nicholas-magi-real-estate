// Test nel browser delle correzioni del pannello di recupero (PR #68).
const {chromium,devices}=require('playwright');const fs=require('fs');const dir=process.argv[2];
const results=[];let failures=0;
function check(name,ok,detail){results.push((ok?"ok   ":"FAIL ")+name+(detail!==undefined?" — "+JSON.stringify(detail):""));if(!ok)failures++;}
async function open(b,query,ctxOpts={},useClock=false){
  const ctx=await b.newContext(ctxOpts);const p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(()=>{localStorage.setItem('nmre-supabase-url','https://stub.supabase.co');localStorage.setItem('nmre-supabase-publishable-key','sb_publishable_stub');});
  await p.route('**/@supabase/supabase-js@2/+esm',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(dir+'/recovery.js','utf8')}));
  await p.route(/unpkg\.com|nominatim|cruscotto|stub\.supabase\.co/,r=>r.abort());
  p.on('dialog',d=>d.accept(d.type()==='prompt'?'Motivo di prova':undefined));
  if(useClock)await p.clock.install();
  await p.goto('http://127.0.0.1:8765/index.html'+query);
  if(useClock)await p.clock.runFor(4000);
  await p.waitForTimeout(2000);
  await p.evaluate(()=>document.querySelector('[data-nmre-nav="candidateSection"]').click());
  await p.waitForTimeout(500);
  return {ctx,p,errors};
}
const wait=(p,ms=700)=>p.waitForTimeout(ms);
const reads=(p,pred)=>p.evaluate(src=>window.__reads.filter(new Function("r","return "+src)).length,pred);
const RECOVERY_SEL='r.t==="annunci_candidati"&&r.sel.includes("storico:dati_estratti->storico_stato")&&r.sel.includes("titolo")';
(async()=>{
  const b=await chromium.launch();

  // ---------- Desktop 1366 px, tabella Fase 2 assente, orologio controllato ----------
  let {ctx,p,errors}=await open(b,'?nodubious=1',{viewport:{width:1366,height:900}},true);
  check("4 · tabella Fase 2 assente: sezione nascosta",await p.evaluate(()=>document.querySelector('#candidateDubiousPanel').hidden));
  check("M4 · pannello chiuso: dati completi degli scartati non letti all'avvio",await reads(p,RECOVERY_SEL)===0);
  check("M4 · nessuna lettura dell'intero dati_estratti degli scartati",await reads(p,'r.t==="annunci_candidati"&&/(^|,)dati_estratti(,|$)/.test(r.sel)')===0);
  check("avviso nuove notifiche disponibile a pannello chiuso",await p.evaluate(()=>!document.querySelector('#candidateRecoveryAlert').hidden),await p.evaluate(()=>document.querySelector('#candidateRecoveryAlert').innerText));
  const before={cand:await reads(p,'r.t==="annunci_candidati"'),idx:await reads(p,'r.t==="annunci_candidati"&&r.sel==="id,url,tipo_venditore,updated_at"'),dub:await reads(p,'r.t==="nmre_gmail_avvisi_dubbi"')};
  await p.clock.runFor(3*60*1000+1000);await wait(p);
  const after={cand:await reads(p,'r.t==="annunci_candidati"'),idx:await reads(p,'r.t==="annunci_candidati"&&r.sel==="id,url,tipo_venditore,updated_at"'),full:await reads(p,RECOVERY_SEL),dub:await reads(p,'r.t==="nmre_gmail_avvisi_dubbi"')};
  check("M4 · 3 aggiornamenti periodici a pannello chiuso: nessuna rilettura completa",after.full===0,after);
  check("M4 · indice degli scartati non riletto prima di 10 minuti",after.idx===before.idx,{before:before.idx,after:after.idx});
  check("M4 · per ogni aggiornamento solo coda + controllo filtrato (3 richieste: coda, pagina filtrata, fine pagine)",after.cand-before.cand===9,{richieste:after.cand-before.cand});
  await p.click('#refreshCandidates');await wait(p);await p.click('#refreshCandidates');await wait(p);
  const dub=await reads(p,'r.t==="nmre_gmail_avvisi_dubbi"');
  check("4/B1 · tabella assente interrogata una sola volta in tutta la sessione (avvio + 3 aggiornamenti + 2 manuali)",dub===1,{richieste:dub});
  // apertura del pannello
  await p.evaluate(()=>{document.querySelector('#candidateRecoveryPanel').open=true;});await wait(p,900);
  const fullReads=await reads(p,RECOVERY_SEL);check("M4 · all'apertura del pannello un solo caricamento completo (pagina + controllo di fine)",fullReads===2,{richieste:fullReads});
  const layout=await p.evaluate(()=>[...document.querySelectorAll('#candidateRecoveryList [data-recovery-item]')].map(card=>{
    const r=e=>e.getBoundingClientRect();const meta=card.querySelector('.candidate-email-meta'),h3=card.querySelector('h3'),actions=card.querySelector('.candidate-actions');
    return {id:card.dataset.recoveryItem,width:Math.round(r(card).width),stacked:r(h3).top>=r(meta).bottom-1&&r(actions).top>=r(h3).bottom-1,display:getComputedStyle(card).display};
  }));
  check("2/M1 · desktop: schede a tutta larghezza con elementi impilati",layout.length>0&&layout.every(c=>c.stacked&&c.width>800&&c.display==="block"),layout);
  await (await p.$('[data-recovery-item="d1"]')).screenshot({path:dir+'/fix_desktop_d1.png'});
  const d5=await p.evaluate(()=>document.querySelector('[data-recovery-item="d5"]').innerText);
  check("8/B5 · 1500 notifiche lette oltre il limite di 1000 righe",/Notifiche ricevute in totale: 1500/.test(d5),d5.split('\n').find(l=>/Notifiche/.test(l)));
  const g1=await p.evaluate(()=>document.querySelector('[data-recovery-item="g1"]').innerText);
  check("B4 · agenzia in attesa: «Ricevuto il», non «Classificato il»",/Ricevuto il 20\/11\/2026/.test(g1)&&!/Classificato il/.test(g1));
  check("B4 · agenzia in attesa non presentata come scarto precedente",!/scarto precedente/.test(g1));
  const r1=await p.evaluate(()=>document.querySelector('#candidateList [data-candidate="r1"]').innerText);
  check("B3 · privato riaperto per ribasso: motivo nella scheda in coda",/Riaperto dopo lo scarto · Nuovo ribasso documentato \(-7%\)/.test(r1));

  // ---------- 6 · Presa visione e secondo scarto ----------
  await p.click('[data-recovery-seen="d1"]');await wait(p,900);
  let d1=await p.evaluate(()=>({card:document.querySelector('[data-recovery-item="d1"]')?.innerText||"",row:window.__db.annunci_candidati.find(r=>r.id==="d1")}));
  check("6 · presa visione: contrassegno tolto",!/Nuova notifica dopo lo scarto/.test(d1.card));
  check("6 · presa visione: storico registrato e dati esistenti conservati",d1.row.dati_estratti.storico_stato.at(-1).azione==="notifica_dopo_scarto_vista"&&d1.row.dati_estratti.pagina_pubblica?.testo.length===2000&&d1.row.dati_estratti.notifiche_dopo_scarto.da_rivedere===false);
  await p.click('[data-recover="d1"]');await wait(p,900);
  await p.evaluate(()=>{window.__db.annunci_candidati.find(r=>r.id==="d1").dati_estratti.notifiche_dopo_scarto.da_rivedere=true;}); // contrassegno di un ciclo precedente ancora attivo
  await p.click('#refreshCandidates');await wait(p);
  await p.click('[data-discard="d1"]');await wait(p,900);
  d1=await p.evaluate(()=>({card:document.querySelector('[data-recovery-item="d1"]')?.innerText||"",stato:window.__db.annunci_candidati.find(r=>r.id==="d1").stato,alert:document.querySelector('#candidateRecoveryAlert').hidden?"":document.querySelector('#candidateRecoveryAlert').innerText}));
  check("6/B2 · secondo scarto: notifica precedente non mostrata come nuova",d1.stato==="scartato"&&d1.card&&!/Nuova notifica dopo lo scarto/.test(d1.card),d1);
  await p.evaluate(()=>window.__sync.notifyAfterDiscard("d1",new Date(Date.now()+60000).toISOString()));
  await p.click('#refreshCandidates');await wait(p,900);
  d1=await p.evaluate(()=>document.querySelector('[data-recovery-item="d1"]')?.innerText||"");
  check("6 · notifica successiva al secondo scarto: mostrata",/Nuova notifica dopo lo scarto/.test(d1));

  // ---------- 5 · Agenzia riportata in revisione e nuova sincronizzazione ----------
  await p.click('[data-recover="d4"]');await wait(p,900);
  let w=await p.evaluate(()=>window.__writes.filter(x=>x.ids.includes("d4")).at(-1).payload);
  check("5/M2 · agenzia scartata: override manuale, versione 100, «Da verificare»",w.seller_manual_override===true&&w.seller_classification_version===100&&w.tipo_venditore==="Da verificare"&&w.stato==="da_verificare",w);
  check("5 · storico: riportato_in_revisione con origine utente",w.dati_estratti.storico_stato.at(-1).azione==="riportato_in_revisione"&&w.dati_estratti.storico_stato.at(-1).origine==="utente");
  let s1=await p.evaluate(()=>window.__sync.deployed("d4")),s2=await p.evaluate(()=>window.__sync.pr("d4"));
  check("5 · dopo la sincronizzazione distribuita resta «Da verificare» e in coda",s1.tipo_venditore==="Da verificare"&&s1.stato==="da_verificare",{tipo:s1.tipo_venditore,stato:s1.stato});
  check("5 · dopo la sincronizzazione della PR resta «Da verificare»",s2.tipo_venditore==="Da verificare"&&s2.stato==="da_verificare");
  const control=await p.evaluate(()=>{const r=window.__db.annunci_candidati.find(x=>x.id==="d4");const saved={...r};r.seller_manual_override=false;const out=window.__sync.deployed("d4");Object.assign(r,saved);return out;});
  check("5 · controllo: senza override la sincronizzazione distribuita la riscarterebbe come agenzia",control.tipo_venditore==="Agenzia"&&control.stato==="scartato");
  await p.click('#refreshCandidates');await wait(p);
  await p.click('[data-recover="g1"]');await wait(p,900);
  s1=await p.evaluate(()=>window.__sync.deployed("g1"));
  check("5 · agenzia in attesa riportata in revisione: resiste alla sincronizzazione",s1.tipo_venditore==="Da verificare"&&s1.seller_manual_override===true);

  // ---------- 7 · Scrittura concorrente tra frontend e sincronizzazione ----------
  await p.click('#refreshCandidates');await wait(p);
  await p.evaluate(()=>{window.__afterRead=row=>{if(row&&row.id==="q1"){const r=window.__db.annunci_candidati.find(x=>x.id==="q1");r.dati_estratti={...r.dati_estratti,dato_della_sincronizzazione:"nuova email"};r.updated_at=new Date(Date.now()+1000).toISOString();}};});
  const writesBefore=await p.evaluate(()=>window.__writes.length);
  await p.click('[data-discard="q1"]');await wait(p,900);
  let q1=await p.evaluate(()=>({row:window.__db.annunci_candidati.find(x=>x.id==="q1"),msg:document.querySelector('#candidateMsg').textContent,writes:window.__writes.length}));
  check("7 · conflitto: nessuna sovrascrittura (record ancora in coda, dato della sincronizzazione presente)",q1.row.stato==="da_verificare"&&q1.row.dati_estratti.dato_della_sincronizzazione==="nuova email"&&!q1.row.dati_estratti.storico_stato,{stato:q1.row.stato});
  check("7 · conflitto: messaggio gestibile all'utente",/modificato nel frattempo/.test(q1.msg)&&/Aggiorni la lista/.test(q1.msg),q1.msg);
  check("7 · conflitto: l'UPDATE non ha toccato righe",await p.evaluate(n=>window.__writes.slice(n).every(x=>x.ids.length===0),writesBefore));
  await p.click('#refreshCandidates');await wait(p);
  await p.click('[data-discard="q1"]');await wait(p,900);
  q1=await p.evaluate(()=>window.__db.annunci_candidati.find(x=>x.id==="q1"));
  check("7 · dopo l'aggiornamento della lista lo scarto riesce e conserva i dati della sincronizzazione",q1.stato==="scartato"&&q1.dati_estratti.dato_della_sincronizzazione==="nuova email"&&q1.dati_estratti.pagina_pubblica.testo.length===2000&&q1.dati_estratti.storico_stato.at(-1).azione==="scartato");
  // conflitto anche sulla presa visione
  await p.evaluate(()=>window.__sync.notifyAfterDiscard("d1",new Date(Date.now()+120000).toISOString()));
  await p.click('#refreshCandidates');await wait(p,900);
  await p.evaluate(()=>{window.__afterRead=row=>{if(row&&row.id==="d1"){window.__sync.notifyAfterDiscard("d1",new Date(Date.now()+180000).toISOString());}};});
  await p.click('[data-recovery-seen="d1"]');await wait(p,900);
  const seenConflict=await p.evaluate(()=>({row:window.__db.annunci_candidati.find(x=>x.id==="d1").dati_estratti.notifiche_dopo_scarto,msg:document.querySelector('#candidateMsg').textContent}));
  check("7 · presa visione concorrente con una nuova notifica: non sovrascritta",seenConflict.row.da_rivedere===true&&seenConflict.row.elenco.length>=3&&/modificato nel frattempo/.test(seenConflict.msg),{da_rivedere:seenConflict.row.da_rivedere,voci:seenConflict.row.elenco.length});
  check("desktop · nessun errore JavaScript",errors.length===0,errors);
  await ctx.close();

  // ---------- 3 · Smartphone (iPhone 13), tabella Fase 2 presente ----------
  ({ctx,p,errors}=await open(b,'',{...devices['iPhone 13']}));
  await p.evaluate(()=>{document.querySelector('#candidateRecoveryPanel').open=true;document.querySelector('#candidateDubiousPanel').open=true;});await wait(p,900);
  const mobile=await p.evaluate(()=>{
    const cards=[...document.querySelectorAll('#candidateRecoveryList .candidate-recovery-card,#candidateDubiousList .candidate-recovery-card')];
    const over=cards.flatMap(c=>[...c.querySelectorAll('*')]).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>window.innerWidth+1||r.left<-1);}).length;
    const targets=cards.flatMap(c=>[...c.querySelectorAll('.candidate-actions a,.candidate-actions button')]).map(e=>({t:e.textContent.trim(),h:Math.round(e.getBoundingClientRect().height)}));
    return {scroll:document.documentElement.scrollWidth,inner:window.innerWidth,over,cards:cards.length,small:targets.filter(t=>t.h<44),targets:targets.length,dubious:!document.querySelector('#candidateDubiousPanel').hidden};
  });
  check("3 · smartphone: nessuno scorrimento orizzontale",mobile.scroll<=mobile.inner&&mobile.over===0,mobile);
  check("3/B6 · smartphone: link e pulsanti alti almeno 44 px",mobile.targets>0&&mobile.small.length===0,mobile.small);
  check("M1 · avvisi dubbi con la stessa impaginazione (tabella presente)",mobile.dubious&&await p.evaluate(()=>getComputedStyle(document.querySelector('[data-dubious-item]')).display==="block"));
  await (await p.$('#candidateRecoveryPanel')).screenshot({path:dir+'/fix_mobile_recovery.png'});
  check("smartphone · nessun errore JavaScript",errors.length===0,errors);
  await ctx.close();

  // ---------- 8 · Più di 1000 scartati: paginazione a chiave e «Mostra altri» ----------
  ({ctx,p,errors}=await open(b,'?big=1&nodubious=1',{viewport:{width:1366,height:900}}));
  await p.evaluate(()=>{document.querySelector('#candidateRecoveryPanel').open=true;});await wait(p,1500);
  const big=await p.evaluate(()=>({summary:document.querySelector('#candidateRecoverySummary').textContent,cards:document.querySelectorAll('#candidateRecoveryList [data-recovery-item]').length,more:!!document.querySelector('#candidateRecoveryMore')}));
  check("8 · 1103 scartati letti oltre il limite di 1000 righe",/1103 scartati/.test(big.summary),big.summary);
  check("8 · prime 300 schede e pulsante «Mostra altri»",big.cards===300&&big.more,big);
  for(let i=0;i<3;i++){await p.click('#candidateRecoveryMore');await wait(p,300);}
  const all=await p.evaluate(()=>({cards:document.querySelectorAll('#candidateRecoveryList [data-recovery-item]').length,more:!!document.querySelector('#candidateRecoveryMore')}));
  check("8 · tutti gli annunci raggiungibili, anche i più vecchi",all.cards===1104&&!all.more,all);
  await ctx.close();await b.close();
  console.log(results.join("\n"));console.log(failures?failures+" controlli non superati":"Tutti i controlli superati ("+results.length+")");
  process.exit(failures?1:0);
})();
