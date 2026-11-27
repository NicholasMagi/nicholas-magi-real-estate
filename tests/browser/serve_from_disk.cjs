// Playwright: serve i file del repository direttamente dal disco su http://127.0.0.1:8765/
// (nessun server da avviare). Caricato con: node -r ./tests/browser/serve_from_disk.cjs
// Serve i file del repository direttamente dal disco a Playwright (nessun server).
const pw=require('playwright');const fs=require('fs');const path=require('path');
// Radice del repository (predefinita: due livelli sopra questo file).
const ROOT=process.env.NMRE_ROOT||path.resolve(__dirname,"..","..");
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
async function serve(target){await target.route(/^http:\/\/127\.0\.0\.1:8765\//,r=>{const u=new URL(r.request().url());const f=path.join(ROOT,decodeURIComponent(u.pathname));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return r.fulfill({status:404,body:''});
 r.fulfill({status:200,contentType:types[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});});}
const origLaunch=pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch=async(...a)=>{const b=await origLaunch(...a);const nc=b.newContext.bind(b);b.newContext=async(...o)=>{const c=await nc(...o);await serve(c);return c;};
 const np=b.newPage.bind(b);b.newPage=async(...o)=>{const p=await np(...o);await serve(p);return p;};return b;};
