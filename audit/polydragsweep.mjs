/* polydragsweep — ทดสอบการลากกรอบบนผังรวมโรงงาน (โหมดแก้ผัง /layout-setup?tab=factory) ในเบราว์เซอร์จริง
   (2026-11-13 · คู่กับ src/utils/polygonEdit.js — เทสหน่วยเช็คสูตร · สคริปต์นี้เช็คว่า "จอ" ต่อสูตรถูก)

   ใช้:  npx vite --config audit/vite.audit.mjs   (เปิดค้างไว้ที่ :5199)
         node audit/polydragsweep.mjs

   กรอบที่ใช้ = rg-1 ใน audit/mockSupabase.js `[[6,8],[44,8],[44,46],[6,46]]` (สี่เหลี่ยมตรงแกน)
   ⚠️ แต่ละเคสโหลดหน้าใหม่ ⇒ เริ่มจากกรอบเดิมทุกครั้ง (mock ไม่จำค่าที่บันทึก)
   "บันทึกไหม" นับจาก window.__qlog — การเรียก from('factory_line_regions') ที่มาจาก endDrag / straightenAll
   ⇒ ไม่ได้ตรวจค่าที่ส่งเข้า DB (mock ไม่เก็บ payload) ตรวจแค่ "เรียกหรือไม่เรียก" + รูปบนจอ */
import { chromium } from 'playwright'

const URL = 'http://localhost:5199/audit/index.html?p=LayoutSetup&tab=factory&role=admin'
const BASE = [[6, 8], [44, 8], [44, 46], [6, 46]]
const TOL = 0.6   // % — ปัดเศษจากพิกเซลเมาส์

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const results = []
const near = (a, e) => Math.abs(a - e) <= TOL
const samePoly = (got, exp) => got.length === exp.length && got.every((p, i) => near(p[0], exp[i][0]) && near(p[1], exp[i][1]))
const fmt = (pts) => JSON.stringify(pts.map(p => p.map(v => Math.round(v * 10) / 10)))

async function openEdit() {
  const p = await b.newPage({ viewport: { width: 1500, height: 1600 }   /* สูงพอให้จุดปลายการลากอยู่ในจอ — ลากเลยขอบล่าง = หน้าเลื่อนระหว่างลาก ระยะเพี้ยน (วัดจริง 30% → 34–38%) */, timezoneId: 'Asia/Bangkok' })
  const errors = []
  p.on('pageerror', e => errors.push(String(e)))
  await p.goto(URL, { waitUntil: 'domcontentloaded' })
  /* /layout-setup เปิดมาในโหมดแก้ผังอยู่แล้ว (ปุ่มหัวเพจขึ้น "เสร็จ") — กด "แก้ผัง" เฉพาะตอนที่ยังไม่อยู่ในโหมด */
  await p.waitForSelector('[data-handle], button:has-text("แก้ผัง")', { timeout: 20000 })
  if (!(await p.locator('[data-handle]').count())) await p.getByRole('button', { name: /แก้ผัง/ }).first().click()
  await p.waitForSelector('[data-handle]', { timeout: 15000 })
  await p.waitForTimeout(300)
  return { p, errors }
}

/* อ่านกรอบ rg-1 จากจอ: จุดมุม = handle กว้าง 14px · กลางขอบ = 10px (ลำดับตาม points) */
const readRegion = (p) => p.evaluate((base) => {
  const groups = [...document.querySelectorAll('[data-handle]')].reduce((m, h) => {
    const g = h.parentElement; if (!m.has(g)) m.set(g, []); m.get(g).push(h); return m
  }, new Map())
  const pct = (h) => [parseFloat(h.style.left), parseFloat(h.style.top)]
  for (const [, hs] of groups) {
    const corners = hs.filter(h => h.style.width === '14px').map(pct)
    if (corners.length === base.length && Math.abs(corners[0][0] - base[0][0]) < 15 && Math.abs(corners[0][1] - base[0][1]) < 15) return corners
  }
  return null
}, BASE)

/* ตำแหน่งพิกเซลของ handle (kind: 'c' มุม · 'e' กลางขอบ) ของกรอบ rg-1 + ขนาดผัง */
const handleBox = (p, kind, idx) => p.evaluate(({ kind, idx, base }) => {
  const groups = [...document.querySelectorAll('[data-handle]')].reduce((m, h) => {
    const g = h.parentElement; if (!m.has(g)) m.set(g, []); m.get(g).push(h); return m
  }, new Map())
  for (const [, hs] of groups) {
    const corners = hs.filter(h => h.style.width === '14px')
    const c0 = corners[0]; if (!c0) continue
    if (Math.abs(parseFloat(c0.style.left) - base[0][0]) > 15 || Math.abs(parseFloat(c0.style.top) - base[0][1]) > 15) continue
    const list = kind === 'c' ? corners : hs.filter(h => h.style.width === '10px')
    const ctr = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
    /* พิกเซลต่อ 1% คิดจากมุม 0 กับมุม 2 ของกรอบเอง (ไม่ใช้ offsetParent — กล่องนั้นไม่ใช่กรอบที่ pctFromEvent ใช้
       วัดจริง: ใช้ offsetParent แล้วลาก 30% ได้ 34.3%) */
    const [x0, y0] = ctr(corners[0]), [x2, y2] = ctr(corners[2])
    const pxX = (x2 - x0) / (parseFloat(corners[2].style.left) - parseFloat(corners[0].style.left))
    const pxY = (y2 - y0) / (parseFloat(corners[2].style.top) - parseFloat(corners[0].style.top))
    const [x, y] = ctr(list[idx])
    return { x, y, w: pxX * 100, h: pxY * 100 }
  }
  return null
}, { kind, idx, base: BASE })

async function drag(p, kind, idx, dxPct, dyPct, { alt = false } = {}) {
  const hb = await handleBox(p, kind, idx)
  if (!hb) throw new Error(`หา handle ${kind}${idx} ไม่เจอ`)
  const tx = hb.x + (dxPct / 100) * hb.w, ty = hb.y + (dyPct / 100) * hb.h
  await p.mouse.move(hb.x, hb.y)
  if (alt) await p.keyboard.down('Alt')
  await p.mouse.down()
  for (let s = 1; s <= 8; s++) await p.mouse.move(hb.x + (tx - hb.x) * s / 8, hb.y + (ty - hb.y) * s / 8)
  await p.mouse.up()
  if (alt) await p.keyboard.up('Alt')
  await p.waitForTimeout(350)
}

const saves = (p) => p.evaluate(() => (window.__qlog?.table('factory_line_regions') || [])
  .filter(r => /endDrag|straightenAll/.test(r.from)).length)

async function runCase(name, fn) {
  const { p, errors } = await openEdit()
  const dialogs = []
  let answer = 'accept'
  p.on('dialog', async d => { dialogs.push(d.message()); await (answer === 'accept' ? d.accept() : d.dismiss()) })
  await p.evaluate(() => window.__qlog?.reset())
  try {
    const before = await readRegion(p)
    if (!before || !samePoly(before, BASE)) throw new Error(`กรอบเริ่มต้นไม่ตรง mock: ${before && fmt(before)}`)
    const r = await fn({ p, dialogs, setAnswer: (a) => { answer = a } })
    const crashed = await p.evaluate(() => !!window.__crash)
    results.push({ name, ok: r.ok && !crashed && !errors.length, detail: r.detail + (crashed ? ' · ❌ หน้าพัง' : '') + (errors.length ? ` · ❌ ${errors[0]}` : '') })
  } catch (e) {
    results.push({ name, ok: false, detail: `❌ ${e.message}` })
  }
  await p.close()
}

/* 1) ลากมุมขวาล่าง +5,+4 — กรอบตรงแกน ⇒ คงมุมฉาก (มุมข้างเคียงเลื่อนตาม) · ขยับไม่ถึง 15% ⇒ ไม่ถาม · บันทึก 1 ครั้ง */
await runCase('ลากมุม = คงมุมฉาก', async ({ p, dialogs }) => {
  await drag(p, 'c', 2, 5, 4)
  const got = await readRegion(p), exp = [[6, 8], [49, 8], [49, 50], [6, 50]], n = await saves(p)
  return { ok: samePoly(got, exp) && n === 1 && !dialogs.length, detail: `ได้ ${fmt(got)} · คาด ${fmt(exp)} · บันทึก ${n} · ถาม ${dialogs.length}` }
})

/* 2) Alt ค้าง = อิสระ ⇒ ขยับจุดเดียว */
await runCase('Alt ค้าง = ลากอิสระ', async ({ p }) => {
  await drag(p, 'c', 2, 5, 4, { alt: true })
  const got = await readRegion(p), exp = [[6, 8], [44, 8], [49, 50], [6, 46]], n = await saves(p)
  return { ok: samePoly(got, exp) && n === 1, detail: `ได้ ${fmt(got)} · คาด ${fmt(exp)} · บันทึก ${n}` }
})

/* 3) ลากกลางขอบบน ขึ้น 3 + เฉียงขวา 7 ⇒ ขยับเฉพาะแนวตั้ง (x ต้องไม่เปลี่ยน) */
await runCase('ลากกลางขอบ = ดันทั้งด้าน', async ({ p }) => {
  await drag(p, 'e', 0, 7, -3)
  const got = await readRegion(p), exp = [[6, 5], [44, 5], [44, 46], [6, 46]], n = await saves(p)
  return { ok: samePoly(got, exp) && n === 1, detail: `ได้ ${fmt(got)} · คาด ${fmt(exp)} · บันทึก ${n}` }
})

/* 4) ลากไกลเกิน 15% แล้วกด "ยกเลิก" ⇒ เด้งกลับรูปเดิม · ไม่บันทึก */
await runCase('ไกลเกินเกณฑ์ + ยกเลิก = คืนรูปเดิม', async ({ p, dialogs, setAnswer }) => {
  setAnswer('dismiss')
  await drag(p, 'c', 2, 0, 20)
  const got = await readRegion(p), n = await saves(p)
  return { ok: samePoly(got, BASE) && n === 0 && dialogs.length === 1, detail: `ได้ ${fmt(got)} · บันทึก ${n} · ถาม ${dialogs.length}${dialogs[0] ? ` "${dialogs[0].split('\n')[0]}"` : ''}` }
})

/* 5) ลากไกลเกิน 15% แล้วกด "ตกลง" ⇒ คงรูปใหม่ · บันทึก */
await runCase('ไกลเกินเกณฑ์ + ยืนยัน = บันทึก', async ({ p, dialogs }) => {
  await drag(p, 'c', 2, 0, 20)
  const got = await readRegion(p), exp = [[6, 8], [44, 8], [44, 66], [6, 66]], n = await saves(p)
  return { ok: samePoly(got, exp) && n === 1 && dialogs.length === 1, detail: `ได้ ${fmt(got)} · บันทึก ${n} · ถาม ${dialogs.length}` }
})

/* 6) ย้ายทั้งกรอบไกลเกินเกณฑ์ (ลากกลางรูป) แล้วยกเลิก ⇒ คืนที่เดิม */
await runCase('ย้ายทั้งกรอบไกล + ยกเลิก = คืนที่เดิม', async ({ p, dialogs, setAnswer }) => {
  setAnswer('dismiss')
  const hb = await handleBox(p, 'c', 0), hb2 = await handleBox(p, 'c', 2)
  const cx = (hb.x + hb2.x) / 2 + 40, cy = (hb.y + hb2.y) / 2 + 40   // เลี่ยงปุ่ม ✕ กลางรูป
  await p.mouse.move(cx, cy); await p.mouse.down()
  for (let s = 1; s <= 8; s++) await p.mouse.move(cx + (0.2 * hb.w) * s / 8, cy)
  await p.mouse.up(); await p.waitForTimeout(350)
  const got = await readRegion(p), n = await saves(p)
  return { ok: samePoly(got, BASE) && n === 0 && dialogs.length === 1, detail: `ได้ ${fmt(got)} · บันทึก ${n} · ถาม ${dialogs.length}` }
})

/* 7) เส้นตัดกันเอง (Alt ลากมุมขวาล่างไปซ้ายเลยขอบซ้าย) ⇒ ไม่บันทึก · ไม่ถาม · คืนรูปเดิม · มี toast */
await runCase('เส้นตัดกันเอง = ห้ามบันทึก', async ({ p, dialogs }) => {
  await drag(p, 'c', 2, -42, -16, { alt: true })
  const got = await readRegion(p), n = await saves(p)
  const toast = await p.evaluate(() => document.body.innerText.includes('เส้นตัดกันเอง'))
  return { ok: samePoly(got, BASE) && n === 0 && !dialogs.length && toast, detail: `ได้ ${fmt(got)} · บันทึก ${n} · ถาม ${dialogs.length} · toast ${toast ? 'มี' : 'ไม่มี'}` }
})

/* 8) ทำให้เอียงนิดหน่อย (Alt +1.5 แนวนอน) แล้วกด 📐 จัดให้ตรง ⇒ กลับมาตรงแกน · Undo ⇒ คืนรูปเอียง */
await runCase('📐 จัดให้ตรง + Undo', async ({ p, dialogs }) => {
  await drag(p, 'c', 2, 1.5, 0, { alt: true })
  const tilted = await readRegion(p)
  await p.evaluate(() => window.__qlog?.reset())
  await p.getByRole('button', { name: /จัดให้ตรง/ }).click()
  await p.waitForTimeout(500)
  const fixed = await readRegion(p), n = await saves(p)
  const aligned = fixed && near(fixed[1][0], fixed[2][0]) && near(fixed[0][1], fixed[1][1]) && near(fixed[2][1], fixed[3][1]) && near(fixed[3][0], fixed[0][0])
  await p.getByRole('button', { name: /^Undo$/ }).click()
  await p.waitForTimeout(500)
  const undone = await readRegion(p)
  return {
    ok: aligned && n >= 1 && dialogs.length === 1 && samePoly(undone, tilted),
    detail: `เอียง ${fmt(tilted)} → จัด ${fmt(fixed)} · บันทึก ${n} · ถาม ${dialogs.length} · Undo ${fmt(undone)}`,
  }
})

await b.close()
let fail = 0
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.detail}`) }
console.log(`\n${results.length} เคส — ผ่าน ${results.length - fail} · ไม่ผ่าน ${fail}`)
process.exit(fail ? 1 : 0)
