const {chromium,devices}=require('playwright');const fs=require('fs');const dir=process.argv[2];
let failures=0;const check=(n,ok,d)=>{console.log((ok?"ok   ":"FAIL ")+n+(d!==undefined?" — "+JSON.stringify(d):""));if(!ok)failures++;};
async function open(b,opts){
  const ctx=await b.newContext(opts);const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(()=>{localStorage.setItem('nmre-supabase-url','https://stub.supabase.co');localStorage.setItem('nmre-supabase-publishable-key','sb_publishable_stub');});
  await p.route('**/@supabase/supabase-js@2/+esm',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(dir+'/subito.js','utf8')}));
  await p.route(/unpkg\.com|nominatim|cruscotto|stub\.supabase\.co/,r=>r.abort());
  await p.goto('http://127.0.0.1:8765/index.html');await p.waitForTimeout(2500);
  await p.evaluate(()=>document.querySelector('[data-nmre-nav="candidateSection"]').click());await p.waitForTimeout(800);
  return {ctx,p,errors};
}
(async()=>{
  const b=await chromium.launch();
  for(const [label,opts] of [["desktop",{viewport:{width:1366,height:900}}],["smartphone",{...devices["iPhone 13"]}]]){
    const {ctx,p,errors}=await open(b,opts);
    const info=await p.evaluate(()=>{
      const card=id=>document.querySelector('#candidateList [data-candidate="'+id+'"]');
      const open=id=>card(id)?.querySelector('[data-open-listing]')?.getAttribute('href')||null;
      const digest=card("sd");
      return {s0:open("s0"),s1:open("s1"),sd:open("sd"),
        s0Item:!!card("s0")?.querySelector('[data-subito-item="608812345"]'),
        digestBox:digest?.querySelector('[data-subito-recovery]')?.innerText||"",
        digestLinks:[...(digest?.querySelectorAll('[data-subito-listing]')||[])].map(a=>a.getAttribute('href')),
        searchLink:digest?.querySelector('[data-subito-search]')?.getAttribute('href')||null,
        scroll:document.documentElement.scrollWidth,inner:innerWidth,
        small:[...(digest?.querySelectorAll('[data-subito-listing],[data-subito-search]')||[])].filter(a=>a.getBoundingClientRect().height<44).length};
    });
    check(label+" · «Apri annuncio» del trilocale apre l'annuncio Subito",info.s0==="https://www.subito.it/appartamenti/trilocale-con-balcone-zona-adriatico-ancona-608812345.htm",info.s0);
    check(label+" · «Apri annuncio» del quadrilocale apre il suo annuncio",info.s1==="https://www.subito.it/appartamenti/quadrilocale-ristrutturato-pinocchio-ancona-608807711.htm",info.s1);
    check(label+" · scheda con riferimento all'ID Subito",info.s0Item);
    check(label+" · notifica da verificare segnalata chiaramente",/Recupero da verificare/.test(info.digestBox)&&/Prima email di questa ricerca/.test(info.digestBox),info.digestBox.slice(0,160));
    check(label+" · un link diretto per ogni annuncio plausibile",info.digestLinks.length===4&&info.digestLinks.every(h=>/^https:\/\/www\.subito\.it\/appartamenti\/.+-\d+\.htm$/.test(h)),info.digestLinks);
    check(label+" · link alla pagina dei risultati",info.searchLink==="https://www.subito.it/annunci-marche/vendita/appartamenti/ancona/?advt=0%2C2&order=datedesc",info.searchLink);
    check(label+" · nessuno scorrimento orizzontale",info.scroll<=info.inner,{scroll:info.scroll,inner:info.inner});
    check(label+" · link alti almeno 44 px",info.small===0,info.small);
    check(label+" · nessun errore JavaScript",errors.length===0,errors);
    if(label==="smartphone")await p.locator('#candidateList [data-candidate="sd"]').screenshot({path:dir+'/subito_digest_mobile.png'});
    else await p.locator('#candidateList [data-candidate="s0"]').screenshot({path:dir+'/subito_item_desktop.png'});
    await ctx.close();
  }
  await b.close();console.log(failures?failures+" controlli non superati":"Tutti i controlli superati");process.exit(failures?1:0);
})();
