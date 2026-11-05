import { createRequire } from 'module'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
import fs from 'fs';
const OUT=process.argv[2]; const SPEC=JSON.parse(fs.readFileSync(process.argv[3]));
const only = process.argv[4] ? process.argv[4].split(',') : null;
const EXE='/opt/pw-browsers/chromium'; const b=await chromium.launch(fs.existsSync(EXE) ? { executablePath: EXE } : {});  // เบราว์เซอร์ที่ติดตั้งในเครื่อง — playwright ใน repo คนละเวอร์ชัน const pg=await b.newPage({viewport:{width:1600,height:1000}});
const res = fs.existsSync(OUT+'/boxes.json') ? JSON.parse(fs.readFileSync(OUT+'/boxes.json')) : {};
async function dismiss(){ for(let i=0;i<20;i++){const x=pg.getByRole('button',{name:/รับทราบ/}).first(); if(!(await x.count()))break; await x.click().catch(()=>{}); await pg.waitForTimeout(100);} }
let LOOSE=false;
async function findVisible(label){
  for (const loc of [pg.getByRole('button',{name:label}), pg.getByText(label,{exact:false})]) {
    const n = await loc.count();
    for (let i=0;i<Math.min(n,30);i++){ const bb = await loc.nth(i).boundingBox().catch(()=>null);
      if (!(bb && bb.width>0 && bb.y>=0 && bb.y+bb.height<=1000 && bb.x>=0 && bb.x<1600)) continue;
      const txt = (await loc.nth(i).innerText().catch(()=>'')).trim();
      if (!LOOSE && txt.length > label.length + 28) continue;   // ข้อความยาว = ย่อหน้าคำอธิบาย ไม่ใช่ปุ่ม
      if (!LOOSE && bb.width > 700) continue;
      return bb; }
  }
  return null;
}
for (const s of SPEC){
  if (only && !only.includes(s.id)) continue;
  await pg.goto(`http://localhost:${process.env.PORT||5198}/audit/index.html?p=${s.p}&role=admin${s.q?'&'+s.q:''}`); await pg.waitForTimeout(3500); await dismiss();
  if (s.scroll){ const t=pg.getByText(s.scroll,{exact:false}).first(); if(await t.count()){ await t.scrollIntoViewIfNeeded(); await pg.evaluate(()=>{ const el=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+5 && getComputedStyle(e).overflowY!=='visible' && e.clientHeight>500)||document.scrollingElement; el.scrollBy(0,-90);}); await pg.waitForTimeout(400);} }
  if (s.click){ const c=pg.getByRole('button',{name:s.click}).first(); if(await c.count()){ await c.scrollIntoViewIfNeeded(); await c.click().catch(()=>{}); await pg.waitForTimeout(1200);} else { const t=pg.getByText(s.click,{exact:false}).first(); if(await t.count()){ await t.click().catch(()=>{}); await pg.waitForTimeout(1200);} else console.log('  click-miss',s.id); } }
  if (s.scrollAfter){ const t=pg.getByText(s.scrollAfter,{exact:false}).first(); if(await t.count()){ await t.scrollIntoViewIfNeeded(); await pg.waitForTimeout(400);} else console.log('  scrollAfter-miss',s.id); }
  LOOSE=!!s.loose; const boxes=[];
  for (const m of s.marks){ const bb=await findVisible(m); boxes.push(bb?{label:m,...bb}:{label:m,miss:true}); }
  const crash = await pg.evaluate(()=>!!window.__crash);
  await pg.screenshot({path:`${OUT}/${s.id}.png`});
  res[s.id]={boxes,crash};
  console.log(s.id, crash?'CRASH':'', 'miss:', boxes.filter(x=>x.miss).map(x=>x.label).join('|'));
}
fs.writeFileSync(OUT+'/boxes.json', JSON.stringify(res,null,1));
await b.close();
