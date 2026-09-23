/* crash-sweep — เปิดทุกหน้าที่ desktop + กดแท็บ/ปุ่มสลับมุมมอง แล้วดูว่า render พังไหม
   ใช้ตอน merge งานหลาย session ชนกัน (build/lint จับ runtime crash ไม่ได้) */
import { chromium } from 'playwright'
/* 🕐 ต้องตั้ง timezone เป็น Asia/Bangkok (2026-09-18) — เดิมเบราว์เซอร์ใน harness เป็น UTC
   ⇒ โค้ดที่ประกอบเวลาจากสตริงไม่มีโซน (`new Date('2026-08-04T08:00:00')` เช่นกรอบเวลากะ)
      ได้คนละเวลากับ timestamp ที่มี +07:00 ⇒ **ช่วงเวลาไม่ทับกันเลย** ⇒ สาย "ช่วงเวลาที่พาร์ทวิ่ง"
      คืนค่าว่างทุกครั้งใน harness ทั้งที่ของจริง (เบราว์เซอร์หน้างาน = ไทย) ทำงานปกติ
   กับดักเดียวกับที่ทำให้สคริปต์ตรวจ OEE ต้องรันด้วย TZ=Asia/Bangkok (ดู docs/modules/oee.md) */
const TZ = { timezoneId: 'Asia/Bangkok' }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p0 = await b.newPage({ ...TZ }); await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200)
const PAGES = await p0.evaluate(() => window.__PAGES); await p0.close()

/* 🔴 ปิด "ฉากทับจอ" ให้ได้จริงก่อนกดปุ่มถัดไป (23/09)
   หลายโมดัลในระบบ **ไม่ปิดด้วย Escape** (ตั้งใจ — กันปิดทิ้งฟอร์มที่กรอกค้าง)
   ถ้าไม่ปิดให้ได้ ปุ่มที่เหลือทั้งหน้าจะโดนฉากทับ แล้ว click timeout ทุกตัว
   ⇒ เครื่องมือรายงาน "พัง 0" ทั้งที่กดจริงได้แค่ 2 ปุ่มแรก (วัดจริงที่ /pm?tab=setup)
   นี่คือเหตุผลที่โมดัล "เพิ่มอุปกรณ์" ที่พังทั้งใบหลุดไปถึงหน้างาน */
const closeOverlay = async (p) => {
  for (let k = 0; k < 3; k++) {
    const blocked = await p.evaluate(() => [...document.querySelectorAll('div')].some(d => {
      const st = getComputedStyle(d); if (st.position !== 'fixed' || st.display === 'none') return false
      const r = d.getBoundingClientRect()
      return r.width > innerWidth * 0.5 && r.height > innerHeight * 0.5 && Number(st.zIndex) >= 100
    }))
    if (!blocked) return
    await p.keyboard.press('Escape').catch(() => {})
    await p.waitForTimeout(160)
    const x = p.locator('button').filter({ hasText: /^\s*(✕|×|ปิด|ยกเลิก)\s*$/ }).last()
    if (await x.count().catch(() => 0)) { await x.click({ timeout: 600 }).catch(() => {}); await p.waitForTimeout(220) }
  }
}

const bad = []
for (const name of PAGES) {
  const p = await b.newPage({ viewport: { width: 1500, height: 900 }, ...TZ })
  const errs = []
  p.on('pageerror', e => errs.push(String(e).split('\n')[0].slice(0, 150)))
  try {
    /* 🔴 ต้องส่ง `role=admin` (23/09) — ไม่ส่ง = harness เรนเดอร์มุมมอง **อ่านอย่างเดียว**
       ปุ่มของ admin (เพิ่ม/แก้ไข/⚙ ตั้งค่า/เปิดโมดัล) ไม่โผล่เลยสักปุ่ม
       วัดจริงที่ /pm?tab=setup: ไม่ส่ง role เห็น 4 ปุ่ม · ส่ง role=admin เห็น 8 ปุ่ม
       ⇒ ครึ่งหนึ่งของส่วนที่กดได้ทั้งแอป **ไม่เคยถูกสวีปเลย** — โมดัลที่พังทั้งใบจึงหลุดถึงหน้างาน */
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await p.waitForTimeout(1100)
    if (await p.evaluate(() => window.__crash)) bad.push({ name, where: 'หน้าแรก', errs: [...errs] })
    else {
      // กดปุ่มบนหัวเพจ (แท็บ/สลับมุมมอง) ทีละอัน แล้ววัดซ้ำ
      /* ⚠️ เพดานนี้เคยเป็น 12 แล้ว **ซ่อนบั๊กจริงไว้** — /heijunka มี 23 ปุ่มบนหัวเพจ
         และแท็บ "🔄 Pull / ใบสั่งผลิต" ที่ทำจอขาวอยู่ index 13 → เครื่องมือรายงาน "พัง 0"
         ทั้งที่พังจริง (full audit 2026-09-02) · ตั้ง 40 ให้ครอบหน้าที่ปุ่มเยอะสุด
         ปรับได้ด้วย env: BTN_CAP=12 node audit/crashsweep.mjs (เร็วขึ้นตอนอยากสวีปคร่าวๆ) */
      const CAP = Number(process.env.BTN_CAP || 40)
      /* 🔴 ต้อง **หา element ใหม่ทุกรอบ** ห้ามเก็บ handle ไว้ก้อนเดียวแล้ววนคลิก (23/09)
         คลิกปุ่มแรกทีเดียวหน้า re-render ⇒ handle ที่เหลือ **detach ทั้งหมด** ⇒ click โยน error
         ⇒ ถูก `catch { continue }` กลืนเงียบ ⇒ เครื่องมือรายงาน "พัง 0" ทั้งที่แทบไม่ได้กดอะไรเลย
         วัดจริงที่ /pm?tab=setup: มี 8 ปุ่ม **คลิกติดแค่ 2** · "+ เพิ่มอุปกรณ์" (index 3) ถูกข้าม
         ⇒ โมดัลที่พังทั้งใบ (TDZ) หลุดถึงหน้างาน ทีมงานแจ้ง "แอพล่ม"
         และต้องกด Escape ปิดโมดัลหลังคลิกทุกครั้ง ไม่งั้นปุ่มถัดไปโดนฉากทับ กดไม่ติดอีก */
      /* 🔴 ไล่คลิกตาม **ข้อความปุ่ม** ไม่ใช่ตาม index — index บน DOM ที่ re-render ทุกคลิก
         ชี้ไปคนละปุ่มตลอด ทำให้ปุ่มสำคัญไม่เคยถูกกดจริง (พิสูจน์แล้ว 23/09: ใส่บั๊กกลับเข้าไป
         แล้วรุ่น index-based ยังรายงาน "พัง 0") */
      const labels = []
      for (const b0 of await p.$$('main button, header button')) {
        const t = ((await b0.textContent()) || '').trim().slice(0, 22)
        if (t && !labels.includes(t)) labels.push(t)
        if (labels.length >= CAP) break
      }
      for (const label of labels) {
        try {
          const loc = p.locator('main button, header button').filter({ hasText: label }).first()
          if (!(await loc.count())) continue
          await loc.click({ timeout: 900 }); await p.waitForTimeout(550)
        } catch { /* กดไม่ติด (โดนฉากทับ/หายไปแล้ว) — ไปตัวถัดไป */ }
        if (await p.evaluate(() => window.__crash)) { bad.push({ name, where: `หลังกด "${label}"`, errs: [...errs] }); break }
        await closeOverlay(p)
      }
    }
  } catch (e) { bad.push({ name, where: 'โหลดไม่ขึ้น', errs: [String(e).slice(0, 120)] }) }
  await p.close()
}
await b.close()
console.log(`ตรวจ ${PAGES.length} หน้า — พัง ${bad.length}`)
bad.forEach(x => console.log(`🔴 ${x.name} [${x.where}] ${x.errs[0] || ''}`))
