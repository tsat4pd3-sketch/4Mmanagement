/* crash-sweep — เปิดทุกหน้าที่ desktop + กดแท็บ/ปุ่มสลับมุมมอง แล้วดูว่า render พังไหม
   ใช้ตอน merge งานหลาย session ชนกัน (build/lint จับ runtime crash ไม่ได้) */
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p0 = await b.newPage(); await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200)
const PAGES = await p0.evaluate(() => window.__PAGES); await p0.close()

const bad = []
for (const name of PAGES) {
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } })
  const errs = []
  p.on('pageerror', e => errs.push(String(e).split('\n')[0].slice(0, 150)))
  try {
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await p.waitForTimeout(1100)
    if (await p.evaluate(() => window.__crash)) bad.push({ name, where: 'หน้าแรก', errs: [...errs] })
    else {
      // กดปุ่มบนหัวเพจ (แท็บ/สลับมุมมอง) ทีละอัน แล้ววัดซ้ำ
      /* ⚠️ เพดานนี้เคยเป็น 12 แล้ว **ซ่อนบั๊กจริงไว้** — /heijunka มี 23 ปุ่มบนหัวเพจ
         และแท็บ "🔄 Pull / ใบสั่งผลิต" ที่ทำจอขาวอยู่ index 13 → เครื่องมือรายงาน "พัง 0"
         ทั้งที่พังจริง (full audit 2026-09-02) · ตั้ง 40 ให้ครอบหน้าที่ปุ่มเยอะสุด
         ปรับได้ด้วย env: BTN_CAP=12 node audit/crashsweep.mjs (เร็วขึ้นตอนอยากสวีปคร่าวๆ) */
      const CAP = Number(process.env.BTN_CAP || 40)
      const btns = await p.$$('main button, header button')
      for (let i = 0; i < Math.min(btns.length, CAP); i++) {
        let label = ''
        try {
          label = ((await btns[i].textContent()) || '').trim().slice(0, 22)
          await btns[i].click({ timeout: 800 }); await p.waitForTimeout(500)
        } catch { continue }
        if (await p.evaluate(() => window.__crash)) { bad.push({ name, where: `หลังกด "${label}"`, errs: [...errs] }); break }
      }
    }
  } catch (e) { bad.push({ name, where: 'โหลดไม่ขึ้น', errs: [String(e).slice(0, 120)] }) }
  await p.close()
}
await b.close()
console.log(`ตรวจ ${PAGES.length} หน้า — พัง ${bad.length}`)
bad.forEach(x => console.log(`🔴 ${x.name} [${x.where}] ${x.errs[0] || ''}`))
