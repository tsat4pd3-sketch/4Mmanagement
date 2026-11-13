// ตัวถ่ายเฉพาะเล่ม ps — ก๊อปจาก kit/shoot.mjs แล้วเพิ่ม 4 อย่าง (08/11/2026):
//  · "scrollTo": "<ข้อความ>" = เลื่อนให้ข้อความนั้นอยู่บนจอ (บนสุด − scrollOff px · ค่าเริ่ม 90)
//    (kit "scroll" ไม่เลื่อนถ้าข้อความเห็นอยู่แล้ว — หน้า Line Stock ที่เนื้อหาอยู่ใต้แถบ KPI จึงต้องใช้ตัวนี้)
//  · mark ขึ้นต้น "~" = หาแบบหลวม (ข้อความยาว/กล่องกว้างได้) เฉพาะ mark นั้น
//  · mark ขึ้นต้น "=" = ข้อความตรงทั้งคำ (ปุ่มในป๊อปอัปที่ชื่อซ้ำกับปุ่มบนการ์ดด้านหลัง)
//  · mark ขึ้นต้น "css=" = หาด้วย CSS selector (ช่อง <select> ที่ข้อความอยู่ใน <option>)
//  · "click" หาไม่เจอเป็นปุ่ม → ลองหาเป็นข้อความ
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
import fs from 'fs';
const OUT=process.argv[2]; const SPEC=JSON.parse(fs.readFileSync(process.argv[3]));
const only = process.argv[4] ? process.argv[4].split(',') : null;
const EXE='/opt/pw-browsers/chromium'; const b=await chromium.launch(fs.existsSync(EXE) ? { executablePath: EXE } : {}); const pg=await b.newPage({viewport:{width:1600,height:1000}, timezoneId:'Asia/Bangkok'});
const res = fs.existsSync(OUT+'/boxes.json') ? JSON.parse(fs.readFileSync(OUT+'/boxes.json')) : {};
async function dismiss(){ for(let i=0;i<20;i++){const x=pg.getByRole('button',{name:/รับทราบ/}).first(); if(!(await x.count()))break; await x.click().catch(()=>{}); await pg.waitForTimeout(100);} }
const inView = (bb) => bb && bb.width>0 && bb.y>=0 && bb.y+bb.height<=1000 && bb.x>=0 && bb.x<1600;
async function findVisible(raw, looseAll){
  if (raw.startsWith('css=')) {
    const loc = pg.locator(raw.slice(4)); const n = await loc.count();
    for (let i=0;i<Math.min(n,30);i++){ const bb = await loc.nth(i).boundingBox().catch(()=>null); if (inView(bb)) return bb; }
    return null;
  }
  const exact = raw.startsWith('=');
  const loose = looseAll || raw.startsWith('~'); const label = raw.replace(/^[~=]/, '');
  for (const loc of [pg.getByRole('button',{name:label, exact}), pg.getByText(label,{exact})]) {
    const n = await loc.count();
    for (let i=0;i<Math.min(n,30);i++){ const bb = await loc.nth(i).boundingBox().catch(()=>null);
      if (!inView(bb)) continue;
      const txt = (await loc.nth(i).innerText().catch(()=>'')).trim();
      if (!loose && txt.length > label.length + 28) continue;   // ข้อความยาว = ย่อหน้าคำอธิบาย ไม่ใช่ปุ่ม
      if (!loose && bb.width > 700) continue;
      return bb; }
  }
  return null;
}
// อุ่นเครื่อง: หน้าแรกหลัง vite เพิ่งขึ้น = จอว่าง (dep ยัง optimize) — โหลดทิ้ง 1 รอบก่อนถ่ายจริง (13/11)
await pg.goto(`http://localhost:${process.env.PORT||5198}/audit/index.html?p=${SPEC[0].p}&role=admin`).catch(()=>{}); await pg.waitForTimeout(8000);
for (const s of SPEC){
  if (only && !only.includes(s.id)) continue;
  await pg.goto(`http://localhost:${process.env.PORT||5198}/audit/index.html?p=${s.p}&role=admin${s.q?'&'+s.q:''}`); await pg.waitForTimeout(3500); await dismiss();
  if (s.scroll){ const t=pg.getByText(s.scroll,{exact:false}).first(); if(await t.count()){ await t.scrollIntoViewIfNeeded(); await pg.evaluate(()=>{ const el=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+5 && getComputedStyle(e).overflowY!=='visible' && e.clientHeight>500)||document.scrollingElement; el.scrollBy(0,-90);}); await pg.waitForTimeout(400);} else console.log('  scroll-miss',s.id); }
  if (s.scrollTo){ const t=pg.getByText(s.scrollTo,{exact:false}).first(); if(await t.count()){ await t.evaluate(e=>e.scrollIntoView({block:'start'})); const off=s.scrollOff??90; await pg.evaluate((off)=>{ const els=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+5 && getComputedStyle(e).overflowY!=='visible' && e.scrollTop>0); (els[0]||document.scrollingElement).scrollBy(0,-off); document.scrollingElement.scrollBy(0,0);}, off); await pg.waitForTimeout(500);} else console.log('  scroll-miss',s.id); }
  if (s.click){ let c=pg.getByRole('button',{name:s.click}).first(); if(!(await c.count())) c=pg.getByText(s.click,{exact:false}).first();
    if(await c.count()){ await c.scrollIntoViewIfNeeded(); await c.click().catch(()=>{}); await pg.waitForTimeout(1200);} else console.log('  click-miss',s.id); }
  const boxes=[];
  for (const m of s.marks){ const bb=await findVisible(m, !!s.loose); boxes.push(bb?{label:m,...bb}:{label:m,miss:true}); }
  const crash = await pg.evaluate(()=>!!window.__crash);
  await pg.screenshot({path:`${OUT}/${s.id}.png`});
  res[s.id]={boxes,crash};
  console.log(s.id, crash?'CRASH':'', 'miss:', boxes.filter(x=>x.miss).map(x=>x.label).join('|'));
}
fs.writeFileSync(OUT+'/boxes.json', JSON.stringify(res,null,1));
await b.close();
