/* ⚡ สูตรพลังงาน — single source of truth (กฎเดียวกับ src/utils/oee.js)
   ห้ามเขียนสูตร kWh / เทียบเดือน / บาทต่อหน่วย เองในหน้าใดๆ · ห้ามแตกไฟล์ util พลังงานเพิ่ม

   เฟส 1 = ไฟฟ้าอย่างเดียว กรอกรายเดือน (คำสั่ง user 2026-08-11)
   โครงเต็ม (มิเตอร์/TOU/demand/SEC) อยู่ docs/ENERGY_MONITORING_DESIGN.md */

/** 'YYYY-MM' ของวันที่ (local time — ห้ามใช้ toISOString ตามกฎ Date/Time ของโปรเจค) */
export function monthKeyOf(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
/** เลื่อนเดือน: shiftMonth('2026-08', -1) → '2026-07' */
export function shiftMonth(key, delta) {
  const [y, m] = String(key).split('-').map(Number)
  const d = new Date(y, (m - 1) + delta, 1)
  return monthKeyOf(d)
}
/** '2026-08' → 'ส.ค. 2569' (พ.ศ. ตามที่ใช้ทั้งระบบ) */
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export function monthLabel(key) {
  const [y, m] = String(key).split('-').map(Number)
  if (!y || !m) return key
  return `${TH_MON[m - 1]} ${y + 543}`
}

/** ตัวเลขหน่วยไฟ — ไม่ปัดให้เหลือ 0 ถ้ามีค่าจริง (ค่าน้อยๆ ต้องยังเห็น) */
export const fmtKwh = (v) => (v == null || !Number.isFinite(Number(v)) ? '—'
  : Number(v) >= 1000 ? `${Math.round(Number(v) / 1000).toLocaleString()}k` : Math.round(Number(v)).toLocaleString())
export const fmtBaht = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : Math.round(Number(v)).toLocaleString())

/** % เปลี่ยนแปลงเทียบฐาน — คืน null เมื่อเทียบไม่ได้ (ห้ามคืน 0 = "ไม่เปลี่ยน" ซึ่งคนละความหมาย) */
export function deltaPct(cur, base) {
  const c = Number(cur), b = Number(base)
  if (!Number.isFinite(c) || !Number.isFinite(b) || b === 0) return null
  return Math.round(((c - b) / b) * 1000) / 10
}

/** บาทต่อหน่วย (จากค่าที่กรอก) — ใช้ตรวจว่ากรอกผิดหลักไหม โรงงานไทยปกติ 3.5-5 บาท/kWh */
export function bahtPerUnit(cost, qty) {
  const c = Number(cost), q = Number(qty)
  if (!Number.isFinite(c) || !Number.isFinite(q) || q === 0) return null
  return Math.round((c / q) * 100) / 100
}
export const RATE_SANE_MIN = 2, RATE_SANE_MAX = 12   // นอกช่วงนี้ = น่าจะกรอกผิดหลัก ให้เตือน (ไม่บล็อก)

/** ที่มาของตัวเลข — ทุกจอต้องติดป้าย ห้ามแสดงค่ากรอกมือให้ดูเหมือนค่าที่วัดจริง */
export const SOURCE_META = {
  manual:    { label: 'กรอกมือ',    icon: '✍️', color: '#f59e0b' },
  meter:     { label: 'จากมิเตอร์', icon: '🔌', color: '#22c55e' },
  estimated: { label: 'ประมาณการ',  icon: '≈',  color: '#9b8de8' },
}
export const sourceMeta = (s) => SOURCE_META[s] || SOURCE_META.manual

/** เกณฑ์สีบนผัง — เทียบเดือนก่อน (ลดลง = ดี) · ไม่มีฐานเทียบ = เทา ไม่ใช่เขียว
 *  ⚠️ "ยังไม่มีข้อมูลให้เทียบ" ≠ "ปกติ" (หลักเดียวกับ OEE null ห้ามแปลงเป็น 0) */
export function energyCat(delta) {
  if (delta == null) return 'idle'
  if (delta <= -5) return 'good'      // ลดลง ≥5%
  if (delta <= 10) return 'ok'        // ทรงตัว
  return 'bad'                        // เพิ่มขึ้น >10%
}

/** รวมยอดตาม scope — ใช้ทั้งหน้ากรอกและผัง (ห้ามรวมเองในหน้า) */
export function sumRows(rows) {
  let qty = 0, cost = 0, n = 0
  for (const r of rows || []) {
    if (r?.qty != null) { qty += Number(r.qty) || 0; n++ }
    if (r?.cost != null) cost += Number(r.cost) || 0
  }
  return { qty: n ? qty : null, cost: cost || null, filled: n }
}

/* ═══════════════════════════════════════════════════════════════════════════
   🌱 Carbon เฟส C1 — ตีหน่วยพลังงานเป็น CO2e
   ขอบเขต: Scope 1+2 เท่านั้น · **ไม่ประเมิน Scope 3** (คำสั่ง user 2026-08-19)
   รายละเอียด + กฎเหล็ก: docs/ENERGY_MONITORING_DESIGN.md §12
   ⚠️ ห้ามแตกไฟล์ carbon.js ใหม่ — สูตรพลังงาน/คาร์บอนอยู่ไฟล์นี้ที่เดียว
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * EF ที่มีผล ณ เดือนนั้น — เลือกแถวที่ `effective_from` ใหม่สุดที่ยัง ≤ **วันแรกของเดือน**
 * (= "ค่าที่เราใช้อยู่ตอนเดือนนั้นเริ่ม")
 * ⚠️ ไม่มี EF ที่ครอบเดือนนั้น → คืน `null` **ห้ามหยิบ EF ปีอื่นมาใช้เงียบๆ**
 *    (กฎโปรเจค: ประเมินไม่ได้ = null + บอกเหตุผล ห้ามแปลงเป็น 0)
 */
export function efFor(utilityKey, monthKey, factors) {
  const at = `${monthKey}-01`
  let best = null
  for (const f of factors || []) {
    if (f?.utility_key !== utilityKey) continue
    const from = String(f.effective_from || '')
    if (!from || from > at) continue
    if (!best || from > String(best.effective_from)) best = f
  }
  return best
}

/** kgCO2e จากปริมาณ + EF — ไม่มีอย่างใดอย่างหนึ่ง = null
 *  ⚠️ ต้องเช็ค null/'' ก่อน Number() — `Number(null)` = **0 ซึ่ง finite**
 *     ปล่อยผ่านจะได้ "0 kgCO2e" (= วัดแล้วไม่ปล่อยเลย) แทน "ยังไม่รู้" ซึ่งคนละความหมาย */
export function co2eKg(qty, ef) {
  if (qty == null || qty === '' || !ef || ef.kg_co2e == null) return null
  const q = Number(qty), k = Number(ef.kg_co2e)
  return Number.isFinite(q) && Number.isFinite(k) ? q * k : null
}

/** kg → tCO2e (ทศนิยม 1 ตำแหน่ง · ค่าน้อยกว่า 0.1 ตันยังต้องเห็น) */
export const fmtTco2e = (kg) => {
  if (kg == null || !Number.isFinite(Number(kg))) return '—'
  const t = Number(kg) / 1000
  return t >= 100 ? Math.round(t).toLocaleString() : (Math.round(t * 10) / 10).toLocaleString()
}

/* ── เครื่องมือวิเคราะห์ (ใช้ในหน้าสรุป — ห้ามคำนวณเองในหน้า) ─────────────── */

/** ช่วงเดือนย้อนหลัง n เดือนจนถึง endKey (เรียงเก่า→ใหม่) — `monthRange('2026-08', 3)` → ['2026-06','2026-07','2026-08'] */
export function monthRange(endKey, n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(endKey, -i))
  return out
}

/**
 * **"ใครทำให้เดือนนี้เปลี่ยน"** — แตกส่วนต่างของยอดรวมลงรายจุด (contribution to change)
 * เป็นคำถามที่ตอบไม่ได้ด้วยกราฟแท่งเรียงยอด: จุดที่ใช้ไฟเยอะที่สุดไม่จำเป็นต้องเป็นตัวที่ทำให้บิลขึ้น
 * @param {Array} items [{ key, label, cur, prev }]
 * @returns {{ total:{cur,prev,delta,pct}, rows:Array }} rows เรียงตาม |delta| มาก→น้อย
 *   แต่ละ row: { key, label, cur, prev, delta, pct (%เทียบตัวเอง), share (%ของส่วนต่างรวม), isNew, isGone }
 */
export function changeContribution(items) {
  let cur = 0, prev = 0, hasCur = false, hasPrev = false
  const rows = []
  for (const it of items || []) {
    const c = it?.cur == null ? null : Number(it.cur)
    const p = it?.prev == null ? null : Number(it.prev)
    if (c != null) { cur += c; hasCur = true }
    if (p != null) { prev += p; hasPrev = true }
    if (c == null && p == null) continue
    rows.push({
      key: it.key, label: it.label,
      cur: c, prev: p,
      delta: (c ?? 0) - (p ?? 0),
      pct: deltaPct(c, p),
      isNew: p == null && c != null,     // เพิ่งเริ่มกรอกเดือนนี้ — ไม่ใช่ "ใช้ไฟเพิ่ม"
      isGone: c == null && p != null,    // เดือนนี้ยังไม่กรอก — ไม่ใช่ "ใช้ไฟลด"
    })
  }
  const totalDelta = (hasCur ? cur : 0) - (hasPrev ? prev : 0)
  const denom = Math.abs(totalDelta) || rows.reduce((s, r) => s + Math.abs(r.delta), 0) || 1
  rows.forEach(r => { r.share = Math.round((r.delta / denom) * 1000) / 10 })
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return {
    total: {
      cur: hasCur ? cur : null, prev: hasPrev ? prev : null,
      delta: hasCur || hasPrev ? totalDelta : null,
      pct: deltaPct(hasCur ? cur : null, hasPrev ? prev : null),
    },
    rows,
  }
}

/**
 * แยก "ที่วัดได้" ออกจาก "ที่ยังไม่ได้แยกมิเตอร์" — ใช้แทนการเตือน "ผลรวมต่างจากบิล X%"
 * ⚠️ ผลรวมรายจุดที่น้อยกว่าบิลมาก **ไม่ใช่ error** ตราบใดที่ยังไม่ได้ติดมิเตอร์ครบ
 *    ของเดิมเตือนว่า -85% ผิดปกติ ทั้งที่กรอกครบทุกจุดที่มีมิเตอร์แล้ว = เตือนผิดที่ คนเลิกเชื่อ
 * @returns {{ metered, bill, unmetered, coverPct, over }}
 *   over = true → ผลรวมมากกว่าบิล = **ผิดจริง** (นับซ้ำ/กรอกผิดหลัก) อันนี้ค่อยเตือน
 */
/* ── SEC / carbon intensity — ผูกพลังงานกับยอดผลิต ─────────────────────────
   ⚠️ **ไม่ใช่เรื่องของ scope** — ไฟที่ซื้อทั้งก้อนเป็น Scope 2 เสมอ ไม่ว่าจะเอาไปใช้ทำอะไร
      การหารด้วยจำนวนชิ้นคือการ "เปลี่ยนหน่วยที่ใช้รายงาน" (CFO → CFP) ไม่ได้เปลี่ยน scope
      รายละเอียด: docs/ENERGY_MONITORING_DESIGN.md §12.3.1
   ⭐ ประโยชน์: ยอด kWh ขึ้น ≠ แย่ลง (อาจแค่ผลิตเยอะขึ้น)
      SEC เป็นตัวเดียวที่แยก "ผลิตเยอะขึ้น" ออกจาก "ใช้ไฟเปลืองขึ้น" */

/** kWh ต่อ 1 ชิ้น (Specific Energy Consumption) — ทศนิยม 3 ตำแหน่ง (ค่ามักน้อยกว่า 1) */
export function secOf(kwh, pieces) {
  if (kwh == null || pieces == null) return null
  const k = Number(kwh), p = Number(pieces)
  if (!Number.isFinite(k) || !Number.isFinite(p) || p <= 0) return null
  return Math.round((k / p) * 1000) / 1000
}

/** kgCO2e ต่อ 1 ชิ้น — carbon intensity (รายงานให้ลูกค้า = CFP ช่วง gate-to-gate) */
export function co2ePerPiece(kgCo2e, pieces) {
  if (kgCo2e == null || pieces == null) return null
  const c = Number(kgCo2e), p = Number(pieces)
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null
  return Math.round((c / p) * 10000) / 10000
}

/**
 * วิธีนับ "ชิ้น" สำหรับ SEC/CFP — **ชิ้นจริง ไม่ใช่ stroke**
 * เหตุผล (ยืนยันกับ user 2026-08-19):
 *   · ลูกค้าซื้อของเป็นชิ้น และถามว่า "พาร์ทนี้ปล่อยกี่ kgCO2e ต่อชิ้น"
 *   · แม่พิมพ์คู่ RH/LH ปั๊มครั้งเดียวได้ 2 ชิ้น → พลังงานต่อชิ้นถูกลงจริงครึ่งหนึ่ง
 *     **นั่นคือประสิทธิภาพที่ควรถูกนับ ไม่ใช่ถูกกลบ**
 * ⚠️ ต่างจากจอสรุปผลิตทุกจอที่นับเป็น stroke (`pairAwareTotal`) → **ทุกจอที่โชว์ SEC ต้องติดป้ายว่านับแบบไหน**
 * ⚠️ แต่ `collapseOps` **ต้องใช้เสมอ** — รายการขั้นตอน (OP) คือชิ้นเดิมที่เดินผ่านสถานี ไม่ใช่ชิ้นใหม่
 *    ไม่ยุบ = ชิ้นเดียวถูกนับ 2-3 รอบ แล้ว SEC ต่ำกว่าความจริงเป็นเท่าตัว
 */
/* ── 📡 MQTT — ค่าที่อ่านจาก topic ได้ (ดู docs/ENERGY_MONITORING_DESIGN.md §14) ──
   ⚠️ kW ≠ kWh — kW = กินอยู่ตอนนี้ (เตือนก่อนชน peak) · kWh = สะสม (บิล/คาร์บอน/SEC)
      มิเตอร์ส่วนใหญ่ส่งทั้งคู่ · kwh_total เป็น "เลขสะสม" ต้องคิดผลต่างเอง (ระวัง counter reset) */
export const MQTT_FIELDS = [
  { key: 'kw',         label: 'กำลังไฟ ณ ตอนนี้', unit: 'kW',   desc: 'ใช้เตือนก่อนชน peak / จับโหลดผี' },
  { key: 'kwh_total',  label: 'หน่วยสะสม',        unit: 'kWh',  desc: 'เลขสะสมหน้ามิเตอร์ — ระบบคิดผลต่างเอง' },
  { key: 'kvar',       label: 'กำลังรีแอกทีฟ',     unit: 'kVAr', desc: 'ไว้ดู power factor' },
  { key: 'pf',         label: 'เพาเวอร์แฟกเตอร์',  unit: '',     desc: 'ต่ำ = โดนค่าปรับ' },
]
export const mqttField = (k) => MQTT_FIELDS.find(f => f.key === k) || { key: k, label: k, unit: '' }

/** ค่าล่าสุดเก่าเกินกี่นาที = ถือว่าขาดการติดต่อ (bridge ส่งราย 15 นาที → เผื่อ 2 รอบ) */
export const LIVE_STALE_MIN = 35
export function liveAgeMin(readAt, nowMs = null) {
  if (!readAt) return null
  const t = new Date(readAt).getTime()
  if (!Number.isFinite(t)) return null
  return Math.round(((nowMs ?? Date.now()) - t) / 60000)
}

export const PIECE_BASIS = 'physical'
export const PIECE_BASIS_LABEL = 'นับชิ้นจริง (งานคู่ LH/RH = 2 ชิ้น)'

export function meteredCoverage(meteredQty, billQty) {
  const m = meteredQty == null ? null : Number(meteredQty)
  const b = billQty == null ? null : Number(billQty)
  if (m == null || b == null || !(b > 0)) {
    return { metered: m, bill: b, unmetered: null, coverPct: null, over: false }
  }
  return {
    metered: m, bill: b,
    unmetered: b - m,
    coverPct: Math.round((m / b) * 1000) / 10,
    over: m > b * 1.02,   // เผื่อ 2% กันเคสปัดเศษ/คร่อมรอบบิล
  }
}
