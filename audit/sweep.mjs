import { chromium } from 'playwright'
import fs from 'fs'
import { PROBE } from './probe.js'
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' })
const p0=await b.newPage(); await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200)
const PAGES=await p0.evaluate(()=>window.__PAGES); await p0.close()

const hits=[]
for (const name of PAGES) {
 for (const W of [320,360,390]) {
  const p=await b.newPage({viewport:{width:W,height:800},isMobile:true,hasTouch:true})
  try{
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}`,{waitUntil:'domcontentloaded',timeout:15000})
    await p.waitForTimeout(900)
    let r=await p.evaluate(PROBE)
    if(r.length) hits.push({name,W,where:'หน้าแรก',r})
    // กดทุกปุ่มที่หน้าตาเหมือนแท็บ/สลับมุมมอง แล้ววัดใหม่
    const btns=await p.$$('main button')
    for (let i=0;i<Math.min(btns.length,14);i++){
      try{ await btns[i].click({timeout:900}); await p.waitForTimeout(450)
        const t=await p.evaluate(PROBE)
        if(t.length){ const lbl=(await btns[i].textContent()||'').trim().slice(0,18)
          hits.push({name,W,where:`หลังกด "${lbl}"`,r:t}); break }
      }catch{}
    }
  }catch{}
  await p.close()
 }
}
await b.close()
fs.writeFileSync('deep.json',JSON.stringify(hits,null,1))
const byPage={}
hits.forEach(h=>{ (byPage[h.name]=byPage[h.name]||[]).push(h) })
console.log('พบล้นจอ', Object.keys(byPage).length, 'หน้า\n')
for (const [n,list] of Object.entries(byPage)) {
  console.log(`### ${n}`)
  const seen=new Set()
  list.forEach(h=>h.r.forEach(x=>{ const k=x.slice(0,60); if(seen.has(k))return; seen.add(k)
    console.log(`   [${h.W}px ${h.where}] ${x}`)}))
}
