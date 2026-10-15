/* handheld-sweep — จำลอง "เครื่อง handheld ที่แจกหน้างาน" (2026-10-15 · คำสั่ง user)
   แจก PDA หน้าตาเหมือนมือถือ 13 เครื่องให้ทุกหน่วยงานใช้จริง ⇒ ต้องรู้ก่อนหน้างานว่าจอไหนใช้ไม่ได้

   ต่างจาก `mobilesweep.mjs` (390px · หน้าแรกอย่างเดียว · 3 อาการ) ตรงที่:
   · จอ **360×640** (ขนาด CSS ของ handheld Android 5–5.5" ส่วนใหญ่ — แคบและเตี้ยกว่า iPhone)
   · ไล่ **ทุกแท็บ** (`[data-tabbar] button`) และ **กดปุ่มเปิดโมดัล** ทีละปุ่ม (ตามข้อความ ไม่ใช่ index)
   · วัด 5 อาการที่คนหน้างานเจอจริง:
     1. ✂️ ตกขอบ — ของที่กด/อ่านได้ ยื่นพ้นขอบขวาจอ แต่ไม่ได้อยู่ในกล่องที่ปัดได้ (`<main>` = overflow clip
        ⇒ **มองไม่เห็นและไปไม่ถึง** ไม่ใช่แค่ต้องปัด)
     2. 🪟 โมดัลไม่พอดีจอ — กล่องโมดัลกว้างเกินจอ หรือสูงเกินจอแล้วเลื่อนไม่ได้ (ปุ่มบันทึกอยู่ใต้จอ)
     3. 👆 เป้ากดเล็ก — ช่องกรอก/select/checkbox/ปุ่ม ที่ "พื้นที่กดจริง" < 28px
        (นับ ::before 40px ของ index.css ให้ปุ่มที่ไม่มีลูกแล้ว — วัดตามที่นิ้วกดได้จริง)
     4. 🔍 ตัวเล็ก — ข้อความที่ฟอนต์ < 11px (ขั้นต่ำของโปรเจค)
     5. 📌 แถบค้างกินจอ — fixed/sticky ที่สูงเกิน 30% ของจอ 640 (ไม่ใช่ฉากโมดัล)

   ใช้: `npx vite --config audit/vite.audit.mjs` ค้างไว้ แล้ว
        node audit/handheldsweep.mjs                 # ทุกหน้า (~15 นาที)
        ONLY=DailyReport,Checkin node audit/handheldsweep.mjs
   ผลเต็มเป็น JSON ที่ OUT (default audit/handheld-report.json — ไม่ commit) */
import { chromium } from 'playwright'
import fs from 'fs'

const VIEW = { width: Number(process.env.W || 360), height: Number(process.env.H || 640) }
const TZ = { timezoneId: 'Asia/Bangkok' }
const OUT = process.env.OUT || 'audit/handheld-report.json'
const BTN_CAP = Number(process.env.BTN_CAP || 25)
// ข้ามปุ่มพิมพ์/ดาวน์โหลด (เปิด print dialog ที่ปิดไม่ได้ — เหตุผลเดียวกับ crashsweep)
const SKIP_RE = /🖨|⬇️|📤|ดาวน์โหลด|ส่งออก|Export|(?<!นำเข้า\s?)(?:Excel|PDF|CSV)|ออกจากระบบ|ลบ|🗑/

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p0 = await b.newPage({ ...TZ }); await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200)
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean)
const PAGES = ONLY.length ? ONLY : await p0.evaluate(() => window.__PAGES); await p0.close()

/* ตัววัดทั้งหมดรันในเบราว์เซอร์ · `scope` = 'page' | 'modal' */
const PROBE = () => {
  const VW = innerWidth, VH = innerHeight
  const out = { offEdge: [], modal: [], small: [], tiny: [], stuck: [] }
  const isVis = (el, cs, r) => r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  const txtOf = el => (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const inHScroller = el => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.id === 'mainbox') return false
      const cs = getComputedStyle(a)
      if (/(auto|scroll)/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 2) return true
      if (/(hidden|clip)/.test(cs.overflowX) && a.getBoundingClientRect().right <= VW + 2) return 'clipped'  // ถูกตัดโดยตั้งใจในกล่องที่อยู่ในจอ
    }
    return false
  }
  const hiddenByAncestor = el => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return true
    }
    return false
  }

  // ── ฉากโมดัล = fixed ที่คลุม ≥85% จอ ──
  const overlays = [...document.querySelectorAll('body *')].filter(d => {
    const cs = getComputedStyle(d); if (cs.position !== 'fixed' || cs.display === 'none') return false
    const r = d.getBoundingClientRect()
    return r.width >= VW * 0.85 && r.height >= VH * 0.85
  })
  const top = overlays[overlays.length - 1] || null
  const root = top || document.getElementById('mainbox') || document.body

  // 2. โมดัล: หากล่องเนื้อหาที่ใหญ่ที่สุดในฉาก
  if (top) {
    let box = null, area = 0
    for (const c of top.querySelectorAll('*')) {
      const r = c.getBoundingClientRect(), cs = getComputedStyle(c)
      if (!isVis(c, cs, r)) continue
      const bg = cs.backgroundColor
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue
      const a = r.width * r.height
      if (a > area && r.width < VW * 1.6 && c !== top) { area = a; box = c }
    }
    if (box) {
      const r = box.getBoundingClientRect()
      const title = txtOf(box).slice(0, 30)
      if (r.width > VW + 2 || r.left < -2) out.modal.push(`กว้าง ${Math.round(r.width)}px เกินจอ ${VW} (ซ้าย ${Math.round(r.left)}) | "${title}"`)
      // ปุ่มในโมดัลที่ไปไม่ถึง: อยู่นอกจอ และไม่มีกล่องเลื่อนแนวตั้งพาไปถึง
      const scrollerY = el => {
        for (let a = el.parentElement; a; a = a.parentElement) {
          const cs = getComputedStyle(a)
          if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 2) return true
          if (a === top) { const c2 = getComputedStyle(top); return /(auto|scroll)/.test(c2.overflowY) && top.scrollHeight > top.clientHeight + 2 }
        }
        return false
      }
      const lost = [...box.querySelectorAll('button')].filter(bt => {
        const br = bt.getBoundingClientRect(), cs = getComputedStyle(bt)
        if (!isVis(bt, cs, br)) return false
        const outV = br.top > VH - 4 || br.bottom < 0
        const outH = br.left > VW - 4 || br.right < 4
        return (outV && !scrollerY(bt)) || (outH && !inHScroller(bt))
      })
      if (lost.length) out.modal.push(`ปุ่มไปไม่ถึง ${lost.length} ปุ่ม เช่น "${txtOf(lost[0])}" | "${title}"`)
    }
  }

  // 1/3/4 วัดภายใน root
  const seenOff = new Set()
  for (const el of root.querySelectorAll('*')) {
    const tag = el.tagName
    if (tag === 'svg' || el.closest('svg')) continue
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    if (!isVis(el, cs, r)) continue
    const interactive = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL)$/.test(tag) || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'tab'
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0)

    // 1. ตกขอบขวา (เฉพาะของที่คนต้องเห็น/กด)
    if ((interactive || ownText) && r.right > VW + 2 && r.left < VW + 400 && cs.position !== 'fixed') {
      const sc = inHScroller(el)
      if (!sc && !hiddenByAncestor(el)) {
        // ขึ้นไปหา "กล่องต้นเหตุ" = บรรพบุรุษตัวแรกที่ใหญ่กว่าจอ
        let cause = el
        for (let a = el.parentElement; a && a.id !== 'mainbox' && a !== document.body; a = a.parentElement) {
          if (a.getBoundingClientRect().width > VW + 2) cause = a; else break
        }
        const k = cause === el ? txtOf(el) : txtOf(cause).slice(0, 25)
        if (!seenOff.has(k)) { seenOff.add(k)
          const cr = cause.getBoundingClientRect(), ccs = getComputedStyle(cause)
          const why = [ccs.display, ccs.gridTemplateColumns && ccs.gridTemplateColumns !== 'none' ? `grid:${ccs.gridTemplateColumns.slice(0, 40)}` : '', ccs.minWidth !== '0px' && ccs.minWidth !== 'auto' ? `minW:${ccs.minWidth}` : '', ccs.width].filter(Boolean).join(' ')
          out.offEdge.push(`${interactive ? tag.toLowerCase() : 'ข้อความ'} "${txtOf(el)}" ขวา ${Math.round(r.right)} · กล่อง ${cause.tagName.toLowerCase()} กว้าง ${Math.round(cr.width)} (${why})`)
        }
      }
    }

    // 3. เป้ากดเล็ก
    if (interactive && tag !== 'LABEL' && r.right > 0 && r.left < VW) {
      let w = r.width, h = r.height
      if (tag === 'BUTTON' && !el.querySelector('*')) { w = Math.max(w, 40); h = Math.max(h, 40) }
      if (tag === 'INPUT' && /checkbox|radio/.test(el.type)) {
        const lab = el.closest('label'); if (lab) { const lr = lab.getBoundingClientRect(); w = Math.max(w, lr.width); h = Math.max(h, lr.height) }
      }
      if (tag === 'INPUT' && el.type === 'hidden') { /* skip */ }
      else if (Math.min(w, h) < 28 && !hiddenByAncestor(el)) out.small.push(`${tag.toLowerCase()}${el.type && tag === 'INPUT' ? ':' + el.type : ''} ${Math.round(r.width)}×${Math.round(r.height)} "${txtOf(el)}"`)
    }

    // 4. ตัวเล็กกว่า 11px
    if (ownText && parseFloat(cs.fontSize) < 10.5 && r.right > 0 && r.left < VW && !hiddenByAncestor(el))
      out.tiny.push(`${cs.fontSize} "${[...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim().slice(0, 30)}"`)

    // 5. fixed/sticky ที่กินจอ (นอกฉากโมดัล)
    if (!top && (cs.position === 'fixed' || (cs.position === 'sticky' && cs.top !== 'auto'))
        && r.height > VH * 0.30 && r.width > VW * 0.6 && r.top < VH * 0.5) {
      let inScroller = false
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ac = getComputedStyle(a); if (a.id === 'mainbox') break
        if (/(auto|scroll)/.test(ac.overflowY) && a.scrollHeight > a.clientHeight + 4) { inScroller = true; break }
      }
      if (!inScroller) out.stuck.push(`${cs.position} ${Math.round(r.width)}×${Math.round(r.height)} | "${txtOf(el)}"`)
    }
  }
  out.small = [...new Set(out.small)]; out.tiny = [...new Set(out.tiny)]; out.stuck = [...new Set(out.stuck)]
  out.hasModal = !!top
  return out
}

const closeOverlay = async (p) => {
  for (let k = 0; k < 3; k++) {
    const blocked = await p.evaluate(() => [...document.querySelectorAll('body *')].some(d => {
      const st = getComputedStyle(d); if (st.position !== 'fixed' || st.display === 'none') return false
      const r = d.getBoundingClientRect(); return r.width > innerWidth * 0.85 && r.height > innerHeight * 0.85
    }))
    if (!blocked) return
    await p.keyboard.press('Escape').catch(() => {})
    await p.waitForTimeout(150)
    const x = p.locator('button').filter({ hasText: /^\s*(✕|×|ปิด|ยกเลิก|✖)\s*$/ }).last()
    if (await x.count().catch(() => 0)) { await x.click({ timeout: 600, force: true }).catch(() => {}); await p.waitForTimeout(200) }
  }
}

const report = []
const t0 = Date.now()
for (const name of PAGES) {
  const p = await b.newPage({ viewport: VIEW, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...TZ })
  const rec = { name, views: [] }
  try {
    const base = name.includes('&') || name.includes('=') ? name : `${name}`
    await p.goto(`http://localhost:5199/audit/index.html?p=${base}&role=admin`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await p.waitForTimeout(1300)
    if (await p.evaluate(() => window.__crash)) { rec.crash = 'หน้าแรก'; report.push(rec); await p.close(); continue }
    // แท็บ
    const tabs = await p.$$eval('[data-tabbar] button', bs => bs.map(x => (x.textContent || '').trim().slice(0, 30)).filter(Boolean)).catch(() => [])
    const views = tabs.length ? tabs : ['(หน้าเดียว)']
    for (const tab of views) {
      if (tabs.length) {
        await closeOverlay(p)
        const loc = p.locator('[data-tabbar] button').filter({ hasText: tab }).first()
        await loc.click({ timeout: 1200 }).catch(() => {})
        await p.waitForTimeout(700)
      }
      const v = { tab, page: await p.evaluate(PROBE), modals: [] }
      if (await p.evaluate(() => window.__crash)) { v.crash = true; rec.views.push(v); break }
      // ปุ่มบนหน้า (ไม่รวมแท็บ) — กดทีละปุ่มดูว่าเปิดโมดัลไหม
      const labels = await p.$$eval('#mainbox button', bs => {
        const L = []
        for (const x of bs) {
          if (x.closest('[data-tabbar]')) continue
          const t = (x.textContent || '').trim().slice(0, 22); if (t && !L.includes(t)) L.push(t)
        }
        return L
      }).catch(() => [])
      let n = 0
      for (const label of labels) {
        if (n >= BTN_CAP) break
        if (SKIP_RE.test(label)) continue
        n++
        try {
          const loc = p.locator('#mainbox button').filter({ hasText: label }).first()
          if (!(await loc.count())) continue
          await loc.click({ timeout: 800 }); await p.waitForTimeout(450)
        } catch { continue }
        const m = await p.evaluate(PROBE)
        if (m.hasModal) v.opened = (v.opened || 0) + 1
        if (m.hasModal && (m.modal.length || m.offEdge.length || m.small.length > 6 || m.tiny.length))
          v.modals.push({ via: label, ...m })
        await closeOverlay(p)
      }
      rec.views.push(v)
    }
  } catch (e) { rec.crash = String(e).slice(0, 100) }
  report.push(rec)
  await p.close()
  process.stdout.write(`· ${name} (${rec.views.length} มุมมอง) ${Math.round((Date.now() - t0) / 1000)}s\n`)
}
await b.close()
fs.writeFileSync(OUT, JSON.stringify(report, null, 1))

// ── สรุป ──
let sum = { offEdge: 0, modal: 0, stuck: 0 }
console.log(`\n══ handheld ${VIEW.width}×${VIEW.height} — ${PAGES.length} หน้า ══`)
for (const r of report) {
  const lines = []
  if (r.crash) lines.push(`💥 crash ${r.crash}`)
  for (const v of r.views) {
    const tag = v.tab === '(หน้าเดียว)' ? '' : `[${v.tab}] `
    v.page.offEdge.forEach(x => { sum.offEdge++; lines.push(`✂️ ${tag}${x}`) })
    v.page.stuck.forEach(x => { sum.stuck++; lines.push(`📌 ${tag}${x}`) })
    for (const m of v.modals) {
      m.modal.forEach(x => { sum.modal++; lines.push(`🪟 ${tag}กด "${m.via}" → ${x}`) })
      m.offEdge.slice(0, 2).forEach(x => { sum.offEdge++; lines.push(`✂️🪟 ${tag}กด "${m.via}" → ${x}`) })
    }
  }
  const small = new Set(r.views.flatMap(v => v.page.small)), tiny = new Set(r.views.flatMap(v => v.page.tiny))
  if (lines.length || small.size > 8 || tiny.size > 5) {
    console.log(`\n### ${r.name}  (👆เล็ก ${small.size} · 🔍ตัวเล็ก ${tiny.size})`)
    lines.slice(0, 12).forEach(l => console.log('   ' + l))
    if (lines.length > 12) console.log(`   … อีก ${lines.length - 12}`)
  }
}
console.log(`\nเปิดโมดัลได้ ${report.reduce((a, r) => a + r.views.reduce((x, v) => x + (v.opened || 0), 0), 0)} ครั้ง · มุมมอง ${report.reduce((a, r) => a + r.views.length, 0)}`)
console.log(`\nรวม: ✂️ตกขอบ ${sum.offEdge} · 🪟โมดัล ${sum.modal} · 📌แถบค้าง ${sum.stuck} · ผลเต็ม ${OUT}`)
