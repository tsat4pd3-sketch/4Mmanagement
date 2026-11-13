import { createRequire } from 'module'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
import fs from 'fs';
const OUT=process.argv[2]; const SPEC=JSON.parse(fs.readFileSync(process.argv[3]));
const only = process.argv[4] ? process.argv[4].split(',') : null;
const EXE='/opt/pw-browsers/chromium'; const b=await chromium.launch(fs.existsSync(EXE) ? { executablePath: EXE } : {}); const pg=await b.newPage({viewport:{width:1600,height:1000}, timezoneId:'Asia/Bangkok'});   // เวลาโรงงาน — เครื่องถ่ายเป็น UTC: ก่อน 08:00 UTC วันงานเลื่อนถอยหลัง การ์ดเลยเวลาทั้งจอ
const res = fs.existsSync(OUT+'/boxes.json') ? JSON.parse(fs.readFileSync(OUT+'/boxes.json')) : {};
async function dismiss(){ for(let i=0;i<20;i++){const x=pg.getByRole('button',{name:/รับทราบ/}).first(); if(!(await x.count()))break; await x.click().catch(()=>{}); await pg.waitForTimeout(100);} }
let LOOSE=false;
async function findVisible(label){
  let EX=false; if (label.startsWith('=')){ EX=true; label=label.slice(1); }   // '=' นำหน้า = ชื่อปุ่มตรงตัว (เช่น "เพิ่ม order" ไม่ใช่ "เพิ่ม order ด่วน")
  for (const loc of [pg.getByRole('button',{name:label,exact:EX}), pg.getByRole('menuitem',{name:label,exact:EX}), pg.getByText(label,{exact:EX})]) {
    const n = await loc.count();
    for (let i=0;i<Math.min(n,30);i++){ const bb = await loc.nth(i).boundingBox().catch(()=>null);
      if (!(bb && bb.width>0 && bb.y>=0 && bb.y+bb.height<=1000 && bb.x>=0 && bb.x<1600)) continue;
      const txt = (await loc.nth(i).innerText().catch(()=>'')).trim();
      if (!LOOSE && txt.length > label.length + 28) continue;   // ข้อความยาว = ย่อหน้าคำอธิบาย ไม่ใช่ปุ่ม
      if (!LOOSE && bb.width > 700) {   // หัวแผง/หัวคอลัมน์ = กล่องกว้างเต็มการ์ด → ใช้กรอบของตัวอักษรจริงแทน
        const tb = await loc.nth(i).evaluate(el=>{ const r=document.createRange(); r.selectNodeContents(el); const b=r.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height}; }).catch(()=>null);
        if (tb && tb.width>0 && tb.width<=700) return tb;
        continue; }
      return bb; }
  }
  return null;
}
for (const s of SPEC){
  if (only && !only.includes(s.id)) continue;
  await pg.goto(`http://localhost:${process.env.PORT||5198}/audit/index.html?p=${s.p}&role=admin${s.q?'&'+s.q:''}`); await pg.waitForTimeout(3500); await dismiss();
  if (s.scroll){ const t=pg.getByText(s.scroll,{exact:false}).first(); if(await t.count()){ await t.scrollIntoViewIfNeeded(); await pg.evaluate(()=>{ const el=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+5 && getComputedStyle(e).overflowY!=='visible' && e.clientHeight>500)||document.scrollingElement; el.scrollBy(0,-90);}); await pg.waitForTimeout(400);} }
  // click = ปุ่มเดียวหรือหลายขั้นตามลำดับ (เมนู ⋯: ["=เพิ่มเติม"] เปิดเมนูค้างไว้ให้วงกลมชี้รายการ · ["=เพิ่มเติม","ป้าย QR"] เปิดหน้าต่างของรายการนั้น)
  for (let ck of (s.click ? [].concat(s.click) : [])){ let EX=false; if (ck.startsWith('=')){ EX=true; ck=ck.slice(1); }
    let c=pg.getByRole('button',{name:ck,exact:EX}).first(); if(!(await c.count())) c=pg.getByRole('menuitem',{name:ck,exact:EX}).first(); if(!(await c.count())) c=pg.getByText(ck,{exact:EX}).first();
    if(await c.count()){ await c.scrollIntoViewIfNeeded(); await c.click().catch(()=>{}); await pg.waitForTimeout(1200);} else console.log('  click-miss',s.id,ck); }
  if (s.clickTitle){ const c=pg.locator('[title*="'+s.clickTitle+'"]').first(); if(await c.count()){ await c.scrollIntoViewIfNeeded(); await c.click().catch(e=>console.log('  ct-err',e.message)); await pg.waitForTimeout(900);} else console.log('  clickTitle-miss',s.id); }
  if (s.scrollTop){ const ok=await pg.evaluate((t)=>{ const el=[...document.querySelectorAll('div,span,h1,h2,h3,b,strong')].filter(e=>(e.innerText||'').includes(t)).sort((a,b)=>a.innerText.length-b.innerText.length)[0]; if(!el) return false; el.scrollIntoView({block:'start'}); window.scrollBy(0,-70); let p=el.parentElement; while(p){ if(p.scrollHeight>p.clientHeight+5 && getComputedStyle(p).overflowY!=='visible'){ p.scrollTop-=70; break;} p=p.parentElement;} return true; }, s.scrollTop); await pg.waitForTimeout(500); if(!ok) console.log('  scrollTop-miss',s.id); }
  if (s.clickJs){ const ok=await pg.evaluate(s.clickJs); await pg.waitForTimeout(900); if(!ok) console.log('  clickJs-miss',s.id); }
  if (s.scrollBy){ await pg.evaluate((dy)=>{ const el=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+5 && getComputedStyle(e).overflowY!=='visible' && e.clientHeight>500)||document.scrollingElement; el.scrollBy(0,dy);}, s.scrollBy); await pg.waitForTimeout(400); }
  LOOSE=!!s.loose; const boxes=[];
  for (const m of s.marks){ const bb=await findVisible(m); boxes.push(bb?{label:m,...bb}:{label:m,miss:true}); }
  const crash = await pg.evaluate(()=>!!window.__crash);
  await pg.screenshot({path:`${OUT}/${s.id}.png`});
  res[s.id]={boxes,crash};
  console.log(s.id, crash?'CRASH':'', 'miss:', boxes.filter(x=>x.miss).map(x=>x.label).join('|'));
}
fs.writeFileSync(OUT+'/boxes.json', JSON.stringify(res,null,1));
await b.close();
