// Importazione della rubrica (PR #78): anteprima, nessuna scrittura prima della conferma, numeri condivisi non uniti.
// Uso: node -r ./tests/browser/serve_from_disk.cjs tests/browser/contacts_import.cjs tests/browser/stubs
const {chromium,devices}=require('playwright');const fs=require('fs');const dir=process.argv[2];
let failures=0;const check=(n,ok,d)=>{console.log((ok?"ok   ":"FAIL ")+n+(d!==undefined?" — "+JSON.stringify(d):""));if(!ok)failures++;};
const VCF=["BEGIN:VCARD","VERSION:3.0","N:Rossi;Mario;;;","FN:Mario Rossi","item1.TEL;type=CELL:+39 333 123 4567","TEL;type=HOME:071 7123456","EMAIL:mario.rossi@example.com","END:VCARD",
 "BEGIN:VCARD","VERSION:2.1","FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Niccol=C3=B2 Neri","TEL;CELL:+393401112233","TEL;HOME:0039 071 222 3344","END:VCARD",
 "BEGIN:VCARD","VERSION:3.0","FN:Luca Gialli","TEL;type=WORK:(071) 555-0199","END:VCARD"].join("\r\n");
(async()=>{const b=await chromium.launch();
 for(const [label,opts] of [["desktop",{viewport:{width:1366,height:900}}],["smartphone",{...devices["iPhone 13"]}]]){
  const ctx=await b.newContext(opts);const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(()=>{localStorage.setItem('nmre-supabase-url','https://stub.supabase.co');localStorage.setItem('nmre-supabase-publishable-key','sb_publishable_stub');});
  await p.route('**/@supabase/supabase-js@2/+esm',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(dir+'/contacts.js','utf8')}));
  await p.route(/unpkg\.com|nominatim|cruscotto|stub\.supabase\.co/,r=>r.abort());
  await p.goto('http://127.0.0.1:8765/index.html');await p.waitForTimeout(2500);
  await p.evaluate(()=>document.querySelector('[data-nmre-nav="nmreCrm"]').click());await p.waitForTimeout(1200);
  const dup=await p.evaluate(()=>({count:document.querySelector('#nmreContactDuplicateCount').textContent,groups:document.querySelectorAll('[data-duplicate-group]').length,text:document.querySelector('#nmreContactDuplicateList').innerText.slice(0,200)}));
  check(label+": possibili duplicati (stesso numero in formati diversi)",dup.count==="1"&&dup.groups===1,dup);
  await p.evaluate(()=>{document.querySelector('#nmreContactImport').open=true;});
  await p.setInputFiles('#nmreContactImportFile',{name:'rubrica.vcf',mimeType:'text/vcard',buffer:Buffer.from(VCF)});await p.waitForTimeout(800);
  const pre=await p.evaluate(()=>({cats:[...document.querySelectorAll('[data-import-category]')].map(d=>d.dataset.importCategory+":"+d.querySelectorAll('li').length),
   confirm:document.querySelector('#nmreContactImportConfirm').hidden?null:document.querySelector('#nmreContactImportConfirm').textContent,writes:window.__writes.filter(w=>w.table==="nmre_contacts").length,
   msg:document.querySelector('#nmreContactImportMsg').textContent,scroll:document.documentElement.scrollWidth,inner:innerWidth}));
  check(label+": anteprima per categoria",JSON.stringify(pre.cats)===JSON.stringify(["nuovo:1","aggiorna:1","da_verificare:1"]),pre.cats);
  check(label+": nulla salvato prima della conferma",pre.writes===0&&/nulla è stato ancora salvato/.test(pre.msg),pre);
  check(label+": nessuno scorrimento orizzontale",pre.scroll<=pre.inner,{scroll:pre.scroll,inner:pre.inner});
  await p.click('#nmreContactImportConfirm');await p.waitForTimeout(1500);
  const after=await p.evaluate(()=>({writes:window.__writes.filter(w=>w.table==="nmre_contacts").map(w=>({op:w.op,name:w.payload?.full_name,email:w.payload?.email,ids:w.ids})),msg:document.querySelector('#nmreContactImportMsg').textContent}));
  const ins=after.writes.filter(w=>w.op==="insert"),upd=after.writes.filter(w=>w.op!=="insert");
  check(label+": un solo contatto creato (Niccolò)",ins.length===1&&ins[0].name==="Niccolò Neri",ins);
  check(label+": Mario aggiornato in modo additivo",upd.length===1&&upd[0].email==="mario.rossi@example.com"&&JSON.stringify(upd[0].ids)==='["c1"]',upd);
  check(label+": Luca (numero condiviso da due contatti) non scritto",!after.writes.some(w=>w.name==="Luca Gialli"),after.writes);
  check(label+": esito comunicato",/Importazione completata/.test(after.msg),after.msg);
  check(label+": nessun errore JavaScript",errors.length===0,errors);
  await ctx.close();
 }
 await b.close();console.log(failures?failures+" controlli non superati":"Tutti i controlli superati");process.exit(failures?1:0);})();
