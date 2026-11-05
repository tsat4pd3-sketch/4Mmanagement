import { createRequire } from 'module'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
import fs from 'fs';
const OUT=process.argv[2]; const SPEC=JSON.parse(fs.readFileSync(process.argv[3]));
const only = process.argv[4] ? process.argv[4].split(',') : null;
const EXE='/opt/pw-browsers/chromium'; const b=await chromium.launch(fs.existsSync(EXE) ? { executablePath: EXE } : {});  // เบราว์เซอร์ที่ติดตั้งในเครื่อง — playwright ใน repo คนละเวอร์ชัน const pg=await b.newPage({viewport:{width:1600,height:1000}});
const res = fs.existsSync(OUT+'/boxes.json') ? JSON.parse(fs.readFileSync(OUT+'/boxes.json')) : {};
async function dismiss(){ for(let i=0;i<20;i++){const x=pg.getByRole('button',{name:/รับทราบ/}).first(); if(!(await x.count()))break; await x.click().catch(()=>{}); await pg.waitForTimeout(100);} }
let LOOSE=false;
async function findVisible(label0){
  const last = label0.endsWith('@last'); const label = last ? label0.slice(0,-5) : label0;
  const cands=[];
  for (const loc of [pg.getByRole('button',{name:label}), pg.getByText(label,{exact:false})]) {
    const n = await loc.count();
    for (let i=0;i<Math.min(n,40);i++){ const bb = await loc.nth(i).boundingBox().catch(()=>null);
      if (!(bb && bb.width>0 && bb.y>=0 && bb.y+bb.height<=1000 && bb.x>=0 && bb.x<1600)) continue;
      const txt = (await loc.nth(i).innerText().catch(()=>'')).trim();
      if (!LOOSE && txt.length > label.length + 28) continue;
      if (!LOOSE && bb.width > 700) continue;
      const core = txt.replace(/^[^\u0E00-\u0E7FA-Za-z0-9+]+/u,'').trim();
      cands.push({bb, score: (core===label||txt===label?0:1)*1000 + txt.length, i:cands.length}); }
  }
  if (!cands.length) return null;
  cands.sort((a,b)=>a.score-b.score || a.i-b.i);
  if (last){ const best=cands[0].score; const same=cands.filter(c=>c.score===best); return same[same.length-1].bb; }
  return cands[0].bb;
}
async function clickL(c){ let l=pg.getByRole('button',{name:c}); if(!(await l.count())) l=pg.getByText(c,{exact:false});
  if(await l.count()){ l=l.last(); await l.scrollIntoViewIfNeeded().catch(()=>{}); await l.click().catch(()=>{}); await pg.waitForTimeout(1300); return true;} console.log('  click-miss',c); return false; }
for (const s of SPEC){
  if (only && !only.includes(s.id)) continue;
  await pg.goto(`http://localhost:${process.env.PORT||5223}/audit/index.html?p=${s.p}&role=admin${s.q?'&'+s.q:''}`); await pg.waitForTimeout(3500); await dismiss();
  for (const a of (s.acts||[])){
    if (a[0]==='click') await clickL(a[1]);
    else if (a[0]==='select'){ const sel=pg.locator('select').nth(a[1]); const v=await sel.evaluate((e,k)=>e.options[k]?.value,a[2]); await sel.selectOption(v).catch(()=>{}); await pg.waitForTimeout(1300); }
    else if (a[0]==='wait') await pg.waitForTimeout(a[1]);
  }
  if (s.scroll){ const t=pg.getByText(s.scroll,{exact:false}).first(); if(await t.count()){ await t.scrollIntoViewIfNeeded(); await pg.waitForTimeout(400);} else console.log('  scroll-miss', s.id); }
  if (s.click) await clickL(s.click);
  LOOSE=!!s.loose; const boxes=[];
  for (const m of s.marks){ const bb=await findVisible(m); boxes.push(bb?{label:m,...bb}:{label:m,miss:true}); }
  const crash = await pg.evaluate(()=>!!window.__crash);
  await pg.screenshot({path:`${OUT}/${s.id}.png`});
  res[s.id]={boxes,crash};
  console.log(s.id, crash?'CRASH':'', 'miss:', boxes.filter(x=>x.miss).map(x=>x.label).join('|'));
}
fs.writeFileSync(OUT+'/boxes.json', JSON.stringify(res,null,1));
await b.close();
