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

/** % เปลี่ยนแปลงเทียบฐาน — คืน null เมื่อเทียบไม่ได้ (ห้ามคืน 0 = "ไม่เปลี่ยน" ซึ่งคนละความหมาย)
 *  ⚠️ ต้องเช็ค null/'' ก่อน Number() — `Number(null) === 0` (finite!) เดิม deltaPct(null, base)
 *  คืน −100 → ชิปเขียว "ลดลง 100%" บนแถวที่แค่ยังไม่กรอก (QC audit 2026-08-20 · T2-13) */
export function deltaPct(cur, base) {
  if (cur == null || cur === '' || base == null || base === '') return null
  const c = Number(cur), b = Number(base)
  if (!Number.isFinite(c) || !Number.isFinite(b) || b === 0) return null
  return Math.round(((c - b) / b) * 1000) / 10
}

/** บาทต่อหน่วย (จากค่าที่กรอก) — ใช้ตรวจว่ากรอกผิดหลักไหม โรงงานไทยปกติ 3.5-5 บาท/kWh
 *  ⚠️ กับดักเดียวกัน: bahtPerUnit(null, q) เคยคืน 0 → ขึ้น "0 ⚠" ส้มบนแถวที่ยังกรอกไม่ครบ */
export function bahtPerUnit(cost, qty) {
  if (cost == null || cost === '' || qty == null || qty === '') return null
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
  { key: 'v',          label: 'แรงดัน',            unit: 'V',    desc: 'Die Shop ส่งค่าเฉลี่ย 3 เฟส' },
  { key: 'a',          label: 'กระแส',             unit: 'A',    desc: 'Die Shop ส่งเฟสที่สูงสุด (เทียบลิมิตเบรกเกอร์)' },
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

/* ══════════════════════════════════════════════════════════════════════════
   🔌 ไลน์แม่ / ไลน์ลูก — "อ่านมิเตอร์ได้แค่ไหน ก็ลงได้แค่นั้น" (2026-09-08)

   ── ปัญหาจริงจากหน้างาน (แชท 2026-09-08) ────────────────────────────────
   ช่าง: "ค่าไฟตัว HDF ที่จะเอาค่ารวม Line Laser ทั้งสอง Line + HDF-01 + HDF-02 เลยใช่มั้ยครับ"
        "จุดจาก micrologic ในห้อง MDB มันแยก HDF-01 กับ HDF-02 ครับ"
   ⇒ **เบรกเกอร์อ่านแยกได้ แต่ระบบให้กรอกได้แค่ไลน์บนสุด** (HYDROFORM) — ทีมเลยต้องยัดค่ารวม
     (Laser 2 ไลน์ + HDF1 + HDF2) ลงช่องเดียว = ทิ้งความละเอียดที่มิเตอร์ให้มาฟรีๆ
     ผิดกฎข้อ 1 ของโมดูลนี้: "เก็บค่าที่อ่านได้ ไม่ใช่ค่าที่คำนวณแล้ว"

   ── กฎที่ใช้ (ยืม pattern ของ src/utils/stdManpower.js มาตรงๆ) ───────────
     **แม่มีค่า = ใช้ของแม่ (ลูกเป็นแค่รายละเอียด) · แม่ไม่มีค่า = รวมลูกขึ้นมา**
   ⚠️ ห้ามบวกแม่ + ลูกเข้าด้วยกันเด็ดขาด — ยอด "ที่วัดได้" จะเกินบิลเป็นเท่าตัว
      (เคยกันไว้ด้วยการ "ไม่ให้กรอกไลน์ลูก" ซึ่งแก้ที่อาการ ไม่ใช่ที่เหตุ)
   ⚠️ ใช้ตัวนี้ **ทุกจุดที่รวมยอดพลังงานรายไลน์** (หน้า /energy + ผังรวม /factory-map)
      ห้ามเขียนกฎนับซ้ำเองในหน้า — ไม่งั้นสองจอตอบไม่ตรงกันเหมือนเคส stdManpower
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * จัดชั้นจุดวัดว่าจุดไหน "นับเข้ายอดรวมได้" และจุดไหน "อยู่ในค่าของแม่แล้ว"
 * @param {Array<{key:string, qty:*}>} items จุดที่จะรวม (qty null/'' = ยังไม่กรอก)
 * @param {(key:string)=>string|null} parentOfKey แม่ของ key ในลำดับชั้น —
 *        ต้องตอบได้แม้ key นั้นไม่อยู่ใน items (จะได้ไล่ข้ามชั้นที่ไม่ได้กรอกขึ้นไปหาแม่ที่กรอกไว้เจอ)
 * @returns {Array} เรียงตาม items เดิม + { qty, counted, coveredBy, childQty, childCount }
 *   counted   = นับเข้ายอดรวมได้ (มีค่า + ไม่มีบรรพบุรุษที่กรอกไว้)
 *   coveredBy = key ของบรรพบุรุษที่กรอกไว้ใกล้สุด (ค่าตัวนี้ถูกนับไปแล้วในนั้น)
 *   childQty  = ผลรวมของลูกหลานที่ "ค่ามาตกที่ตัวนี้" — ใช้ทวนว่าลูกรวมแล้วเท่ากับแม่ไหม
 */
export function energyRollup(items, parentOfKey) {
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const qtyOf = new Map();
  for (const it of items || []) if (it?.key != null) qtyOf.set(it.key, num(it.qty));
  const parent = (k) => (typeof parentOfKey === 'function' ? parentOfKey(k) : null) || null;

  /** บรรพบุรุษที่กรอกค่าไว้ใกล้สุด (null = ไม่มี → จุดนี้เป็นตัวนับ) */
  const filledAncestor = (key) => {
    const seen = new Set([key]);
    let p = parent(key), depth = 0;
    while (p && !seen.has(p) && depth++ < 10) {   // กัน parent วนกันเอง (กฎเดียวกับ stdGroupOf)
      if (qtyOf.get(p) != null) return p;
      seen.add(p);
      p = parent(p);
    }
    return null;
  };

  const out = (items || []).map(it => {
    const qty = qtyOf.get(it.key) ?? null;
    const coveredBy = qty == null ? null : filledAncestor(it.key);
    return { ...it, qty, coveredBy, counted: qty != null && coveredBy == null, childQty: null, childCount: 0 };
  });
  const byKey = new Map(out.map(r => [r.key, r]));
  for (const r of out) {
    if (r.qty == null || !r.coveredBy) continue;
    const owner = byKey.get(r.coveredBy);
    if (!owner) continue;                       // แม่อยู่นอกลิสต์ (โดน scope ตัด) — ไม่มีที่ให้ทวน
    owner.childQty = (owner.childQty ?? 0) + r.qty;
    owner.childCount += 1;
  }
  return out;
}

/** สัดส่วน % ของส่วนย่อยในยอดรวม — เทียบไม่ได้ = null (ห้ามคืน 0 = "ไม่มีเลย" ซึ่งคนละความหมาย) */
export function pctOf(part, whole) {
  if (part == null || part === '' || whole == null || whole === '') return null;
  const p = Number(part), w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w === 0) return null;
  return Math.round((p / w) * 1000) / 10;
}

/**
 * ค่าที่กรอก "หลุดช่วงที่เคยเป็น" ไหม — กันพิมพ์ผิดหลัก (เคสจริง: Utility Hydroforming เม.ย. 69
 * ลงไว้ 953,940 kWh ทั้งที่เดือนอื่น 50,000-75,000 → ผลรวมรายจุดทะลุยอดบิลทั้งโรงงาน)
 * ⚠️ **เตือนเฉยๆ ห้ามบล็อก** — ค่าผิดปกติจริงก็มี (เดือนที่เปิดเครื่องใหม่/รวมสองรอบบิล)
 *    ระบบไม่มีทางรู้แทนคน หน้าที่เราคือทำให้เห็น ไม่ใช่ตัดสินแทน
 * @returns {null | { ratio:number, median:number, kind:'high'|'low' }}
 */
export function outlierVsHistory(qty, history, factor = 3) {
  const v = qty == null || qty === '' ? null : Number(qty);
  const past = (history || []).map(Number).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v == null || !Number.isFinite(v) || v <= 0 || past.length < 3) return null;
  const mid = Math.floor(past.length / 2);
  const median = past.length % 2 ? past[mid] : (past[mid - 1] + past[mid]) / 2;
  if (!(median > 0)) return null;
  const ratio = Math.round((v / median) * 100) / 100;
  if (ratio >= factor) return { ratio, median, kind: 'high' };
  if (ratio <= 1 / factor) return { ratio, median, kind: 'low' };
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ⚡ บอร์ดค่าไฟสด (/energy แท็บ "ค่าไฟสด" · 2026-11-09 · docs/ENERGY_MONITORING_DESIGN.md §15)
   ข้อมูล: energy_live (ค่าล่าสุด) · energy_daily (ยอดรายวัน — trigger คิดให้) · energy_readings (รายนาที)
   ตัวส่ง: Node-RED Die Shop ยิงทุก 1 นาที
   ⚠️ ห้ามคิดสถานะ/ยอดรวมตู้/แจ้งเตือนเองในหน้า — ใช้ buildLiveBoard() ตัวเดียว
   ═══════════════════════════════════════════════════════════════════════════ */

/** ไม่มีค่าใหม่เกินกี่นาที = ขาดการติดต่อ (ตัวส่งยิงทุก 1 นาที → เผื่อ 2 รอบหลุด) */
export const METER_OFFLINE_MIN = 3

/** 'never' = ไม่เคยได้รับค่าเลย (≠ ค่าเป็น 0) · 'offline' = เคยได้แต่ขาดไป · 'online' */
export function meterStatus(receivedAt, nowMs = Date.now()) {
  const age = liveAgeMin(receivedAt, nowMs)
  if (age == null) return 'never'
  return age > METER_OFFLINE_MIN ? 'offline' : 'online'
}

const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * ประกอบบอร์ดสดทั้งหน้า
 * @param {object} p
 * @param {Array} p.meters   energy_live_meters ที่ is_active
 * @param {Array} p.live     energy_live ทุกแถว
 * @param {Array} p.daily    energy_daily ของเดือนนี้ (ทุกวันในเดือน)
 * @param {string} p.today   'YYYY-MM-DD' วันตามปฏิทินไทย (bkkDateStr)
 * @param {number} p.nowMs
 * @returns {{ meters:Array, panels:Array, totals:object }}
 *   ตัวเลขที่ไม่รู้ = null เสมอ (ห้ามเป็น 0 — "ยังไม่ได้รับค่า" ≠ "ไม่ใช้ไฟ")
 */
export function buildLiveBoard({ meters = [], live = [], daily = [], today, nowMs = Date.now() } = {}) {
  const liveBy = new Map()
  for (const l of live || []) {
    const k = `${l.scope_kind}|${l.scope_name}`
    if (!liveBy.has(k)) liveBy.set(k, {})
    liveBy.get(k)[l.field] = l
  }
  const dayBy = new Map()
  for (const d of daily || []) {
    const k = `${d.scope_kind}|${d.scope_name}`
    if (!dayBy.has(k)) dayBy.set(k, [])
    dayBy.get(k).push(d)
  }

  const out = [...(meters || [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.scope_name).localeCompare(String(b.scope_name)))
    .map(m => {
      const k = `${m.scope_kind}|${m.scope_name}`
      const f = liveBy.get(k) || {}
      const recv = Object.values(f).map(x => x.received_at).filter(Boolean).sort().pop() || null
      const status = meterStatus(recv, nowMs)
      const days = dayBy.get(k) || []
      const td = days.find(d => d.day === today) || null
      const limitKw = numOrNull(m.limit_kw), limitA = numOrNull(m.limit_a)
      const kw = numOrNull(f.kw?.value), a = numOrNull(f.a?.value)
      // ค่าเก่าเกินเกณฑ์ไม่ตัดสินเกินลิมิต — ไม่รู้ว่าตอนนี้เป็นยังไง
      const overKw = status === 'online' && kw != null && limitKw != null && kw > limitKw
      const overA = status === 'online' && a != null && limitA != null && a > limitA
      return {
        key: k, name: m.scope_name, panel: m.panel || '—', subtitle: m.subtitle || '',
        limitKw, limitA,
        gaugeMax: numOrNull(m.gauge_max_kw) ?? (limitKw != null ? limitKw * 1.5 : null),
        kw, a, v: numOrNull(f.v?.value), kwhTotal: numOrNull(f.kwh_total?.value),
        receivedAt: recv, ageMin: liveAgeMin(recv, nowMs), status,
        todayKwh: td ? numOrNull(td.kwh) : null,
        todayResets: td ? (td.resets || 0) : 0,
        peakKw: td ? numOrNull(td.peak_kw) : null, peakAt: td?.peak_at || null,
        monthKwh: days.length ? days.reduce((s, d) => s + (numOrNull(d.kwh) || 0), 0) : null,
        monthDays: new Set(days.map(d => d.day)).size,
        overKw, overA,
      }
    })

  const sumKnown = (arr) => { const xs = arr.filter(x => x != null); return xs.length ? xs.reduce((s, x) => s + x, 0) : null }

  const panelMap = new Map()
  for (const m of out) {
    if (!panelMap.has(m.panel)) panelMap.set(m.panel, [])
    panelMap.get(m.panel).push(m)
  }
  const panels = [...panelMap.entries()].map(([panel, ms]) => {
    const on = ms.filter(m => m.status === 'online')
    return {
      panel, meters: ms, online: on.length, total: ms.length,
      // ยอดตู้ = ผลรวมเครื่องที่ออนไลน์เท่านั้น · ไม่ครบ = partial (จอต้องเขียนว่ากี่/กี่เครื่อง)
      kw: sumKnown(on.map(m => m.kw)), partial: on.length < ms.length,
      todayKwh: sumKnown(ms.map(m => m.todayKwh)),
    }
  })

  const allDays = new Set()
  for (const m of out) for (const d of dayBy.get(m.key) || []) allDays.add(d.day)
  const monthKwh = sumKnown(out.map(m => m.monthKwh))
  const online = out.filter(m => m.status === 'online').length
  const totals = {
    kw: sumKnown(out.filter(m => m.status === 'online').map(m => m.kw)),
    todayKwh: sumKnown(out.map(m => m.todayKwh)),
    monthKwh,
    monthDays: allDays.size,
    avgPerDay: monthKwh != null && allDays.size ? monthKwh / allDays.size : null,
    online, offline: out.filter(m => m.status === 'offline').length,
    never: out.filter(m => m.status === 'never').length, total: out.length,
    alerts: out.filter(m => m.overKw || m.overA),
    resets: out.reduce((s, m) => s + m.todayResets, 0),
  }
  return { meters: out, panels, totals }
}

/**
 * กราฟเส้นต่อเครื่อง + peak ของตู้ จากแถวรายนาที
 * @returns {{ byScope: Map<string, Array<{t:number, kw:number}>>, panelPeak: {kw,at,full}|null }}
 *   panelPeak คิดเฉพาะนาทีที่ "ทุกเครื่องในตู้ส่งค่ามาครบ" — นาทีที่ขาดบางเครื่องจะต่ำกว่าจริง
 */
export function liveSeries(readings, meters) {
  const byScope = new Map()
  for (const r of readings || []) {
    const kw = numOrNull(r.kw)
    const t = Date.parse(r.bucket_at)
    if (kw == null || !Number.isFinite(t)) continue
    const k = `${r.scope_kind}|${r.scope_name}`
    if (!byScope.has(k)) byScope.set(k, [])
    byScope.get(k).push({ t, kw })
  }
  for (const arr of byScope.values()) arr.sort((a, b) => a.t - b.t)

  const keys = (meters || []).map(m => `${m.scope_kind}|${m.scope_name}`)
  let panelPeak = null
  if (keys.length) {
    const perT = new Map()
    for (const k of keys) for (const p of byScope.get(k) || []) {
      const cur = perT.get(p.t) || { sum: 0, n: 0 }
      cur.sum += p.kw; cur.n++
      perT.set(p.t, cur)
    }
    for (const [t, v] of perT) {
      if (v.n < keys.length) continue
      if (!panelPeak || v.sum > panelPeak.kw) panelPeak = { kw: v.sum, at: t }
    }
  }
  return { byScope, panelPeak }
}

/**
 * ⚡ ค่าไฟสดของ "กรอบบนผังโรงงาน" (FactoryMap metric พลังงาน · 2026-11-09)
 * กรอบ = ชุดชื่อไลน์ (familyNames — แม่ + ลูก) · ตู้ไหนจ่ายให้ไลน์ไหน = ไลน์ของเครื่องที่ผูกใน energy_meter_machines
 * 🔴 ตู้ 1 ตู้จ่ายหลายไลน์ได้ (DB-LASER = LASER-345 + LASER-789) — **ห้ามหารแบ่ง** (ไม่มีมิเตอร์รายไลน์ = ไม่รู้สัดส่วน)
 *    ⇒ คืน `sharedWith` = ไลน์นอกกรอบที่ใช้ตู้เดียวกัน ให้จอเขียน "รวมกับ …"
 * @param {string[]} names       ชื่อไลน์ในกรอบ
 * @param {Array} boardMeters    buildLiveBoard().meters
 * @param {Map<string,Set<string>>} meterLines  key ตู้ ('zone|DB-LASER') → ชุดไลน์ที่ตู้จ่ายให้
 * @returns {null | { kw, online, total, over, meters:string[], sharedWith:string[] }}
 *   null = กรอบนี้ไม่มีตู้สด · kw = null เมื่อทุกตู้ไม่ออนไลน์ (ห้ามเป็น 0)
 */
export function liveForNames(names, boardMeters, meterLines) {
  const set = new Set(names || [])
  const hit = (boardMeters || []).filter(m => [...(meterLines?.get(m.key) || [])].some(l => set.has(l)))
  if (!hit.length) return null
  const on = hit.filter(m => m.status === 'online' && m.kw != null)
  const shared = new Set()
  for (const m of hit) for (const l of meterLines.get(m.key) || []) if (!set.has(l)) shared.add(l)
  return {
    kw: on.length ? on.reduce((s, m) => s + m.kw, 0) : null,
    online: on.length, total: hit.length,
    over: hit.some(m => m.overKw || m.overA),
    meters: hit.map(m => m.name),
    sharedWith: [...shared].sort(),
  }
}

/** ตู้ → ชุดไลน์ที่ตู้จ่ายให้ จากแถว energy_meter_machines ที่ embed `machines(line_name)` (ใช้ทั้งค่าสดและทบทวนรายวัน) */
export function meterLinesFrom(rows) {
  const out = new Map()
  for (const x of rows || []) {
    const ln = x?.machines?.line_name
    if (!ln) continue
    const k = `${x.scope_kind}|${x.scope_name}`
    if (!out.has(k)) out.set(k, new Set())
    out.get(k).add(ln)
  }
  return out
}

/**
 * 📅 kWh ของ "วันที่เลือก" จากมิเตอร์ ของกรอบบนผัง (FactoryMap โหมดทบทวน · 2026-11-10)
 * คู่กับ liveForNames — กฎเดียวกัน: ตู้ละครั้ง · ตู้หลายไลน์ห้ามหารแบ่ง (sharedWith)
 * @param {Map<string,object>} byMeter  key ตู้ → แถว energy_daily ของวันนั้น
 * @returns {null | { kwh, have, total, meters, sharedWith, resets }}
 *   null = กรอบนี้ไม่มีตู้ผูก · kwh = null เมื่อไม่มีตู้ไหนมียอดวันนั้น (ห้ามเป็น 0 — มิเตอร์อาจยังไม่เริ่มส่ง)
 */
export function dayForNames(names, byMeter, meterLines) {
  const set = new Set(names || [])
  const keys = [...(meterLines || new Map()).keys()].filter(k => [...meterLines.get(k)].some(l => set.has(l)))
  if (!keys.length) return null
  const rows = keys.map(k => byMeter?.get(k)).filter(r => r && r.kwh != null)
  const shared = new Set()
  for (const k of keys) for (const l of meterLines.get(k)) if (!set.has(l)) shared.add(l)
  return {
    kwh: rows.length ? rows.reduce((s, r) => s + Number(r.kwh), 0) : null,
    have: rows.length, total: keys.length,
    meters: keys.map(k => k.split('|')[1]),
    sharedWith: [...shared].sort(),
    resets: rows.reduce((s, r) => s + (r.resets || 0), 0),
  }
}

/** ความละเอียดกราฟจิ๋วบนการ์ดผัง = 15 นาที (หน่วยเดียวกับ demand charge · 1 วันเต็ม = 96 จุด) */
export const MAP_SPARK_MIN = 15

/** แถวรายนาที → ค่าเฉลี่ย kW ต่อช่วง ต่อตู้ : Map(keyตู้ → Map(เวลาเริ่มช่วง ms → kW เฉลี่ย)) */
export function bucketByMeter(readings, bucketMin = MAP_SPARK_MIN) {
  const acc = new Map()
  const size = bucketMin * 60000
  for (const r of readings || []) {
    const kw = numOrNull(r.kw), t = Date.parse(r.bucket_at)
    if (kw == null || !Number.isFinite(t)) continue
    const k = `${r.scope_kind}|${r.scope_name}`, b = Math.floor(t / size) * size
    if (!acc.has(k)) acc.set(k, new Map())
    const m = acc.get(k), cur = m.get(b) || { s: 0, n: 0 }
    cur.s += kw; cur.n++
    m.set(b, cur)
  }
  const out = new Map()
  for (const [k, m] of acc) out.set(k, new Map([...m].map(([b, v]) => [b, v.s / v.n])))
  return out
}

/**
 * กราฟจิ๋ว "วันนี้" ของกรอบบนผัง = ผลรวม kW ของตู้ที่จ่ายให้กรอบนี้ (ตู้ละครั้ง — กฎเดียวกับ liveForNames)
 * 🔴 นับเฉพาะช่วงที่ **ทุกตู้ของกรอบส่งค่ามาครบ** — ช่วงที่ขาดบางตู้จะดิ่งลงหลอกว่าไฟลด
 * @returns {number[]} เรียงเก่า→ใหม่ · ว่าง = ไม่วาด (Spark ต้อง ≥ 2 จุด)
 */
export function sparkForNames(names, meterBuckets, meterLines) {
  const set = new Set(names || [])
  const keys = [...(meterLines || new Map()).keys()].filter(k => [...meterLines.get(k)].some(l => set.has(l)))
  if (!keys.length) return []
  const times = new Set()
  for (const k of keys) for (const t of meterBuckets?.get(k)?.keys() || []) times.add(t)
  const out = []
  for (const t of [...times].sort((a, b) => a - b)) {
    let sum = 0, ok = true
    for (const k of keys) {
      const v = meterBuckets.get(k)?.get(t)
      if (v == null) { ok = false; break }
      sum += v
    }
    if (ok) out.push(sum)
  }
  return out
}

/* ═══ 🔍 หน้ารายตู้ (/energy?tab=live&meter=<ชื่อตู้> · 2026-11-10 · คำสั่ง user "คลิกการ์ดเข้าหน้าตู้แบบ Node-RED") ═══
   ข้อมูลที่ ESM มี = สรุปรายนาที (energy_readings เก็บ 7 วัน) — ไม่มี 3 เฟสแยก/รายวินาที (จอต้องบอก ห้ามแต่งค่า) */

/** ช่วงที่ขาดเกินกี่นาทีถึงตัดเส้น (ตัวส่งยิงทุก 1 นาที — ขาด 1-2 รอบยังลากต่อได้) */
export const DETAIL_GAP_MIN = 5

/**
 * แถวรายนาทีของตู้เดียว → จุดกราฟ [{ t, kw, a, v }] เรียงเก่า→ใหม่
 * · ค่าที่อ่านไม่ได้ = null (เส้นขาด · ห้ามเป็น 0)
 * · ช่วงที่ไม่มีแถวเกิน DETAIL_GAP_MIN นาที ⇒ แทรกจุด null ให้กราฟตัดเส้น (ไม่ลากข้ามช่วงที่มิเตอร์หลุด)
 */
export function meterDetailSeries(rows) {
  const pts = []
  for (const r of rows || []) {
    const t = Date.parse(r.bucket_at)
    if (!Number.isFinite(t)) continue
    pts.push({ t, kw: numOrNull(r.kw), a: numOrNull(r.a), v: numOrNull(r.v) })
  }
  pts.sort((x, y) => x.t - y.t)
  const out = []
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i].t - pts[i - 1].t > DETAIL_GAP_MIN * 60000) {
      out.push({ t: pts[i - 1].t + 60000, kw: null, a: null, v: null })
    }
    out.push(pts[i])
  }
  return out
}

/**
 * สัดส่วนโหลดตอนนี้ = kW ของเครื่อง ÷ kW รวมของเครื่องที่ออนไลน์
 * 🔴 เครื่องที่ไม่ออนไลน์/ไม่รู้ค่า = pct null (ไม่ใช่ 0%) · ไม่มีใครออนไลน์ = total null
 * @returns {{ total:number|null, rows:Array<{key,name,kw,pct}> }}
 */
export function loadShare(boardMeters) {
  const on = (boardMeters || []).filter(m => m.status === 'online' && m.kw != null)
  const total = on.length ? on.reduce((s, m) => s + Math.max(0, m.kw), 0) : null
  const rows = (boardMeters || []).map(m => {
    const ok = m.status === 'online' && m.kw != null
    return { key: m.key, name: m.name, kw: ok ? m.kw : null, pct: ok && total ? (Math.max(0, m.kw) / total) * 100 : null }
  })
  return { total, rows }
}
