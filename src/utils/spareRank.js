// Rank อะไหล่ A/B/C ตาม WI-JIG-010 "การแบ่งหมวดหมู่ตามความสำคัญ Spare part" (Rev.00 · Effective 07/04/2026)
// ── ตารางที่ 1 (แกนตั้ง = จำนวนการใช้เฉลี่ยต่อเดือน · แกนนอน = Leadtime) ────────────
//                    │ <15 วัน │ <45 วัน │ >45 วัน
//   >10 ชิ้น/เดือน    │    A    │    A    │    A
//   ≤10 ชิ้น/เดือน    │    B    │    B    │    A
//   <3  ชิ้น/เดือน    │    C    │    B    │    A
//
//   Rank A : ใช้ >10 ชิ้น/เดือน หรือ leadtime >45 วัน → ต้องมีมากกว่าค่า Safety Stock เสมอ
//   Rank B : ใช้ ≤10 ชิ้น/เดือน หรือ leadtime <45 วัน → มี Safety Stock
//   Rank C : ใช้ <3 ชิ้น/เดือน  และ leadtime <15 วัน  → ไม่มี Safety Stock
//
// ไฟล์นี้เป็น pure function ทั้งหมด (ไม่แตะ DB/DOM) — แก้เกณฑ์ที่นี่ที่เดียว
// ⚠️ ห้าม hardcode เกณฑ์ Rank ซ้ำในหน้าใดๆ ให้เรียกผ่าน util นี้เสมอ

export const RANK_META = {
  A: { key: 'A', label: 'A', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  desc: 'ต้องมีมากกว่าค่า Safety Stock เสมอ', short: 'สำคัญสูง — ห้ามขาด' },
  B: { key: 'B', label: 'B', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', desc: 'มี Safety Stock',                    short: 'สำคัญปานกลาง — มีสำรอง' },
  C: { key: 'C', label: 'C', color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  desc: 'ไม่มี Safety Stock',                 short: 'สำคัญต่ำ — สั่งเมื่อใช้' },
}

// เกณฑ์ตาม WI (แก้ที่นี่ที่เดียวถ้า WI ออก Rev. ใหม่)
export const RANK_RULE = {
  usageHigh: 10,   // > 10 ชิ้น/เดือน = แถวบน
  usageLow: 3,     // < 3  ชิ้น/เดือน = แถวล่าง
  ltShort: 15,     // < 15 วัน  = คอลัมน์ซ้าย
  ltLong: 45,      // > 45 วัน  = คอลัมน์ขวา
  windowMonths: 6, // หน้าต่างเฉลี่ยการใช้ย้อนหลัง (WI ไม่ได้ระบุ — เลือก 6 เดือนให้ลื่นไหลกับฤดูกาลผลิต)
}

/** ช่องในตารางที่ 1 → Rank · คืน null เมื่อข้อมูลไม่พอตัดสิน (ไม่เดา)
 *  @param {number|null} avgPerMonth จำนวนการใช้เฉลี่ยต่อเดือน (ชิ้น)
 *  @param {number|null} leadTimeDays ระยะเวลาจัดส่ง (วัน) */
export function rankFromMatrix(avgPerMonth, leadTimeDays) {
  // ⚠️ ห้ามใช้ Number(x) เช็คว่า "มีค่าไหม" — Number(null) = 0 (ไม่ใช่ NaN)
  //    เคยพลาดตรงนี้: อะไหล่ที่ยังไม่มีประวัติการใช้ ถูกตีเป็น "ใช้ 0 ชิ้น/เดือน" แล้วจัดเป็น C ทันที
  const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const u = numOrNull(avgPerMonth)
  const lt = numOrNull(leadTimeDays)
  const hasU = u !== null
  const hasLt = lt !== null && lt > 0
  const { usageHigh, usageLow, ltShort, ltLong } = RANK_RULE

  // ขอบตาราง: ตัดสินได้ทันทีแม้รู้แกนเดียว (ทั้งแถวบน/คอลัมน์ขวาเป็น A ทั้งแนว)
  if (hasU && u > usageHigh) return 'A'
  if (hasLt && lt > ltLong) return 'A'
  if (!hasU || !hasLt) return null           // นอกขอบ A ต้องรู้ทั้ง 2 แกนถึงแยก B/C ได้

  // ถึงตรงนี้: usage ≤ 10 และ leadtime ≤ 45
  if (u < usageLow) return lt < ltShort ? 'C' : 'B'
  return 'B'                                  // 3 ≤ usage ≤ 10 → B ทั้งคอลัมน์ซ้าย/กลาง
}

/** คีย์เดือน 'YYYY-MM' ย้อนหลัง n เดือน (รวมเดือนปัจจุบัน) เรียงเก่า→ใหม่
 *  ใช้เวลาท้องถิ่น (เครื่องอยู่ไทย) ให้ตรงกับ trigger ฝั่ง DB ที่ bucket ด้วย Asia/Bangkok
 *  ⚠️ ห้ามใช้ toISOString() (UTC — เดือนเพี้ยนช่วงต้น/ปลายเดือน) ตามกฎ Date/Time ใน CLAUDE.md */
export function monthKeysBack(n = RANK_RULE.windowMonths, ref = new Date()) {
  const out = []
  const y = ref.getFullYear(), m = ref.getMonth()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** รวมยอดใช้ (qty_out) ต่อเดือนจากหลาย source — system (ledger) + manual (ยอดย้อนหลังจาก Excel)
 *  @param {Array} rows แถว mtn_spare_usage_monthly ของอะไหล่ตัวเดียว
 *  @returns {Map<string, {out:number, in:number}>} */
export function usageByMonth(rows = []) {
  const map = new Map()
  for (const r of rows) {
    const k = r?.month_key; if (!k) continue
    const cur = map.get(k) || { out: 0, in: 0 }
    cur.out += Number(r.qty_out) || 0
    cur.in += Number(r.qty_in) || 0
    map.set(k, cur)
  }
  return map
}

/** จำนวนการใช้เฉลี่ยต่อเดือน — หารด้วย "จำนวนเดือนที่อะไหล่ตัวนี้มีอยู่จริง" ในหน้าต่าง
 *  (อะไหล่ที่เพิ่งเพิ่มเดือนนี้ ไม่ถูกหารด้วย 6 จนค่าเฉลี่ยต่ำเกินจริง) */
export function avgMonthlyUsage(rows = [], { months = RANK_RULE.windowMonths, createdAt = null, ref = new Date() } = {}) {
  const keys = monthKeysBack(months, ref)
  const byMonth = usageByMonth(rows)
  const inWindow = keys.filter(k => byMonth.has(k))
  let total = 0
  for (const k of keys) total += (byMonth.get(k)?.out || 0)

  let divisor = keys.length
  if (createdAt) {
    const c = new Date(createdAt)
    if (!isNaN(c)) {
      const elapsed = (ref.getFullYear() - c.getFullYear()) * 12 + (ref.getMonth() - c.getMonth()) + 1
      divisor = Math.max(1, Math.min(keys.length, elapsed))
    }
  }
  // hasHistory = มีเดือนไหน "ถูกบันทึกไว้" บ้างในหน้าต่างนี้ (ledger หรือยอดย้อนหลังที่คีย์จาก Excel)
  //   ไม่มีเลย = ยังไม่รู้ว่าใช้เท่าไหร่ (≠ ใช้ 0) — ต้นทางของกฎ "ไม่มีข้อมูล = ไม่จัด Rank"
  return { avg: total / divisor, total, months: divisor, keys, byMonth, hasHistory: inWindow.length > 0 }
}

/** Rank สุดท้ายของอะไหล่ 1 ตัว (รวม override) — ตัวหลักที่ UI เรียกใช้
 *  @param {object} part แถว mtn_spare_parts
 *  @param {Array}  usageRows แถว mtn_spare_usage_monthly ของอะไหล่ตัวนี้ */
export function computeSpareRank(part = {}, usageRows = [], opts = {}) {
  const { avg, total, months, keys, byMonth, hasHistory } = avgMonthlyUsage(usageRows, { ...opts, createdAt: part.created_at })
  const lt = part.lead_time_days === null || part.lead_time_days === undefined || part.lead_time_days === ''
    || !Number.isFinite(Number(part.lead_time_days)) ? null : Number(part.lead_time_days)
  // ยังไม่มีประวัติการใช้เลย = "ไม่รู้" ไม่ใช่ "ใช้ 0" — ส่ง null ให้ตารางตัดสิน
  //   สำคัญตอนย้ายข้อมูลจาก Excel เข้าระบบครั้งแรก: ทุกตัวยังไม่มี ledger ถ้าตีเป็น 0 จะกลายเป็น C ยกคลัง
  //   (แกน leadtime ยังตัดสิน A ได้เองถ้า LT > 45 วัน — ข้อมูลนั้นมาจาก Excel อยู่แล้ว)
  const calc = rankFromMatrix(hasHistory ? avg : null, lt)
  const override = ['A', 'B', 'C'].includes(part.rank_override) ? part.rank_override : null
  const rank = override || calc

  return {
    rank,                                  // Rank ที่ใช้จริง (override ชนะ) · null = ข้อมูลไม่พอ
    calcRank: calc,                         // Rank ที่คำนวณตาม WI
    override,                               // ค่าที่ถูกทับไว้ (ถ้ามี)
    overridden: !!override && override !== calc,
    avgPerMonth: avg,
    totalUsed: total,
    months,
    monthKeys: keys,
    byMonth,
    hasHistory,
    leadTimeDays: lt,
    // เหตุผลที่ข้อมูลไม่พอ — บอกให้ชัดว่าต้องเติมอะไร ไม่ปล่อยให้ว่างเงียบๆ
    missing: calc ? null : (lt == null ? 'lead_time' : 'usage'),
  }
}

/** ตรวจว่า Safety Stock (min_qty) สอดคล้องกับ Rank ตามนิยามใน WI หรือยัง
 *  A/B ต้องมี Safety Stock (min_qty > 0) · C ไม่ต้องมี — คืน null = ไม่มีอะไรต้องเตือน
 *  หมายเหตุ: WI ไม่ได้ให้สูตรจำนวน Safety Stock จึงตรวจแค่ "มี/ไม่มี" ไม่คำนวณตัวเลขให้เอง */
export function safetyStockIssue(rank, minQty) {
  const min = Number(minQty) || 0
  if (!rank) return null
  if ((rank === 'A' || rank === 'B') && min <= 0) return { level: 'warn', text: `Rank ${rank} ต้องมี Safety Stock — ยังไม่ได้ตั้งขั้นต่ำ` }
  if (rank === 'C' && min > 0) return { level: 'info', text: 'Rank C ตาม WI ไม่ต้องมี Safety Stock' }
  return null
}

/** สถานะสต็อกเทียบ min/max — ใช้ระบายสีแถว/ชิป (Andon: แดง=ขาด, เหลือง=ต่ำ, ฟ้า=เกิน) */
export function stockState(part = {}) {
  const qty = Number(part.stock_qty) || 0
  const min = Number(part.min_qty) || 0
  const max = Number(part.max_qty) || 0
  if (qty <= 0) return { key: 'out', label: 'หมด', color: '#ef4444' }
  if (min > 0 && qty <= min) return { key: 'low', label: 'ต่ำกว่าขั้นต่ำ', color: '#f59e0b' }
  if (max > 0 && qty > max) return { key: 'over', label: 'เกินสูงสุด', color: '#38bdf8' }
  return { key: 'ok', label: 'ปกติ', color: '#22c55e' }
}
