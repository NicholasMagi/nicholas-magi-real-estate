// Avviso di blocco della sincronizzazione Gmail (PR #77): visibile, leggibile su smartphone, apre il monitor.
// Uso: node -r ./tests/browser/serve_from_disk.cjs tests/browser/sync_alert.cjs tests/browser/stubs
const {chromium,devices}=require('playwright');const fs=require('fs');const dir=process.argv[2];
let failures=0;const check=(n,ok,d)=>{console.log((ok?"ok   ":"FAIL ")+n+(d!==undefined?" — "+JSON.stringify(d):""));if(!ok)failures++;};
(async()=>{const b=await chromium.launch();
 for(const [label,opts,query] of [["desktop · blocco",{viewport:{width:1366,height:900}},""],["smartphone · blocco",{...devices["iPhone 13"]},""],["desktop · regolare",{viewport:{width:1366,height:900}},"?syncok=1"]]){
  const ctx=await b.newContext(opts);const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(()=>{localStorage.setItem('nmre-supabase-url','https://stub.supabase.co');localStorage.setItem('nmre-supabase-publishable-key','sb_publishable_stub');});
  await p.route('**/@supabase/supabase-js@2/+esm',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(dir+'/sync.js','utf8')}));
  await p.route(/unpkg\.com|nominatim|cruscotto|stub\.supabase\.co/,r=>r.abort());
  await p.goto('http://127.0.0.1:8765/index.html'+query);await p.waitForTimeout(2500);
  const s=await p.evaluate(()=>{const a=document.querySelector('#nmreSyncAlert');const r=a.getBoundingClientRect();return {hidden:a.hidden,visible:!!(r.width&&r.height),title:document.querySelector('#nmreSyncAlertTitle').textContent,text:document.querySelector('#nmreSyncAlertText').textContent,scroll:document.documentElement.scrollWidth,inner:innerWidth,btn:document.querySelector('#nmreSyncAlertOpen').getBoundingClientRect().height};});
  if(query){check(label+": nessun avviso",s.hidden===true,s);}
  else{
   check(label+": avviso visibile",!s.hidden&&s.visible,s);
   check(label+": testo del blocco",s.title==="Acquisizione Gmail bloccata."&&/3 sincronizzazioni consecutive/.test(s.text),s.text);
   check(label+": nessuno scorrimento orizzontale",s.scroll<=s.inner,{scroll:s.scroll,inner:s.inner});
   check(label+": pulsante alto almeno 44 px",s.btn>=44,s.btn);
   await p.click('#nmreSyncAlertOpen');await p.waitForTimeout(800);
   const shown=await p.evaluate(()=>{const el=document.querySelector('#gmailSyncTitle');const sec=el.closest('section');return {visible:!!el.getClientRects().length,section:sec?.id||null};});
   check(label+": il pulsante apre il monitor",shown.visible,shown);
  }
  check(label+": nessun errore JavaScript",errors.length===0,errors);
  await ctx.close();
 }
 await b.close();console.log(failures?failures+" controlli non superati":"Tutti i controlli superati");process.exit(failures?1:0);})();
