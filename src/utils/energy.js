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
