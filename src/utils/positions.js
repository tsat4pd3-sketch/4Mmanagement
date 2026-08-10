// ตำแหน่งงาน (job position) + ระดับงาน (level) — source of truth เดียวทุกหน้า
//   ใช้ทั้งพนักงาน (employees.position — Register/operator) และ user (profiles.position — AddUser)
//
// ⚠️ กฎเก็บค่า: **DB เก็บ "key" · หน้าจอ/ใบพิมพ์แสดง "ชื่อ" ผ่าน positionLabel()**
//   (หลักเดียวกับ team / role / process_type ทั้งระบบ — ชื่อเปลี่ยนได้ ถ้าเก็บชื่อข้อมูลเก่ากำพร้าทันที)
//   เดิมเป็น free text ปนไทย-อังกฤษ: Operator 195 + พนักงานฝ่ายผลิต 6 = อันเดียวกัน แต่แยกกันในข้อมูล
//   → migration 20260806_positions_master.sql รวมเป็น key เดียวแล้ว
//
// แบ่ง 2 ชั้นโดยตั้งใจ:
//   ตาราง `positions` (DB)      = "ชื่อตำแหน่ง" — ข้อมูล เปลี่ยนบ่อย ต่างกันได้ทุกโรงงานตอน rollout
//   POSITION_LEVELS (ไฟล์นี้)   = "ระดับงาน" — แนวคิด TPM ที่นิ่ง ใช้ตัดสินว่าใครทำ AM ใครทำ PM
//   เพิ่มตำแหน่งใหม่ = เพิ่มแถวใน `positions` ชี้ไป level เดิม · ไม่ต้องแตะโค้ด
import { supabase } from '../supabaseClient'

/** ระดับงาน — `maintenance` บอกว่าระดับนี้ควรทำงานบำรุงรักษาแบบไหน
 *    'am'   = พนักงานหน้างานตรวจเองทุกต้นกะ
 *    'pm'   = ช่างตรวจตามรอบเวลา/ยอดผลิต/เงื่อนไข
 *    'both' = ระดับหัวหน้า ดูแลทั้งสองฝั่ง
 *    null   = สายสนับสนุน ไม่ควรมีสิทธิ์บันทึก/อนุมัติผลตรวจ (ธุรการ/เลขา/เจ้าหน้าที่)
 *  ⚠️ ใช้เป็น "คำแนะนำ/คำเตือน" เท่านั้น — สิทธิ์จริงยังคุมที่ role_permissions ตามเดิม
 *     (ห้ามเอามาบล็อกการทำงาน เพราะหน้างานมีข้อยกเว้นเสมอ) */
export const POSITION_LEVELS = [
  { key: 'operator',   label: 'ปฏิบัติการ (หน้างาน)', rank: 10, maintenance: 'am' },
  { key: 'staff',      label: 'ธุรการ / สนับสนุน',    rank: 10, maintenance: null },
  { key: 'technician', label: 'ช่างเทคนิค',           rank: 20, maintenance: 'pm' },
  { key: 'engineer',   label: 'วิศวกร',               rank: 30, maintenance: 'pm' },
  { key: 'leader',     label: 'หัวหน้าไลน์',          rank: 40, maintenance: 'am' },
  { key: 'supervisor', label: 'หัวหน้าแผนก / ส่วน',   rank: 50, maintenance: 'both' },
  { key: 'manager',    label: 'ผู้จัดการ',            rank: 60, maintenance: 'both' },
]
export const levelMeta = (lv) => POSITION_LEVELS.find(l => l.key === lv) || null

// fallback ตอนตารางยังไม่ apply / โหลดไม่ทัน — ต้องตรงกับ seed ใน migration
export const DEFAULT_POSITIONS = [
  { key: 'operator',     label_th: 'พนักงานฝ่ายผลิต', level: 'operator',   sort_order: 10 },
  { key: 'technician',   label_th: 'ช่างเทคนิค',      level: 'technician', sort_order: 20 },
  { key: 'engineer',     label_th: 'วิศวกร',          level: 'engineer',   sort_order: 30 },
  { key: 'qc',           label_th: 'QC',              level: 'technician', sort_order: 35 },
  { key: 'line_leader',  label_th: 'หัวหน้าไลน์',     level: 'leader',     sort_order: 40 },
  { key: 'dept_head',    label_th: 'หัวหน้าแผนก',     level: 'supervisor', sort_order: 50 },
  { key: 'section_head', label_th: 'หัวหน้าส่วน',     level: 'supervisor', sort_order: 60 },
  { key: 'manager',      label_th: 'ผู้จัดการฝ่าย',   level: 'manager',    sort_order: 70 },
  { key: 'officer',      label_th: 'เจ้าหน้าที่',     level: 'staff',      sort_order: 80 },
  { key: 'clerk',        label_th: 'ธุรการ',          level: 'staff',      sort_order: 85 },
  { key: 'secretary',    label_th: 'เลขา',            level: 'staff',      sort_order: 90 },
]

let _cache = null
let _inflight = null
export function clearPositionsCache() { _cache = null; _inflight = null }

export async function loadPositions() {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = (async () => {
    try {
      const { data } = await supabase.from('positions').select('*').eq('is_active', true).order('sort_order')
      _cache = (data && data.length) ? data : DEFAULT_POSITIONS
    } catch { _cache = DEFAULT_POSITIONS }
    _inflight = null
    return _cache
  })()
  return _inflight
}
/** อ่านแบบ sync จาก cache (ต้องเรียก loadPositions() มาก่อน) — ไม่มี cache คืน DEFAULT */
export const positionsSync = () => _cache || DEFAULT_POSITIONS

const rows = () => positionsSync()

/** ค่าใดๆ (key หรือชื่อไทย/อังกฤษเก่า) → key · ไม่รู้จัก = คืนค่าเดิม (ไม่กลืนหาย) */
export function positionKeyOf(v) {
  const s = String(v || '').trim(); if (!s) return ''
  const low = s.toLowerCase()
  const hit = rows().find(p =>
    String(p.key || '').toLowerCase() === low ||
    String(p.label_th || '').toLowerCase() === low ||
    String(p.label_en || '').toLowerCase() === low)
  return hit ? hit.key : s
}
/** ค่าใดๆ → ชื่อที่ใช้ "แสดง" (ไทย) — ห้ามเอาไปเก็บลง DB · ไม่รู้จัก = คืนค่าเดิมให้เห็น */
export function positionLabel(v) {
  const s = String(v || '').trim(); if (!s) return ''
  const low = s.toLowerCase()
  const hit = rows().find(p =>
    String(p.key || '').toLowerCase() === low ||
    String(p.label_th || '').toLowerCase() === low ||
    String(p.label_en || '').toLowerCase() === low)
  return hit ? (hit.label_th || hit.key) : s
}
/** ค่าใดๆ → ระดับงาน (key ของ POSITION_LEVELS) · ไม่รู้จัก = null */
export function levelOfPosition(v) {
  const k = positionKeyOf(v)
  return rows().find(p => p.key === k)?.level || null
}
/** ระดับนี้ควรทำงานบำรุงรักษาแบบไหน — 'am' | 'pm' | 'both' | null (ไม่รู้จัก/สายสนับสนุน) */
export function maintenanceKindOfPosition(v) {
  const lv = levelOfPosition(v)
  return lv ? (levelMeta(lv)?.maintenance ?? null) : null
}

/** ตัวเลือกสำหรับ dropdown — [{ value: key, label: ชื่อไทย, level }] */
export const positionOptions = () =>
  rows().map(p => ({ value: p.key, label: p.label_th || p.key, level: p.level }))

/** เติมค่าปัจจุบันที่อยู่นอก master (ค่าที่คนพิมพ์เอง) ไว้หัวลิสต์ — ไม่ให้หายตอนบันทึก */
export const positionOptionsWith = (current) => {
  const opts = positionOptions()
  const cur = String(current || '').trim()
  return cur && !opts.some(o => o.value === cur) ? [{ value: cur, label: cur, level: null }, ...opts] : opts
}

// ── legacy: ลิสต์ชื่อไทยล้วน (โค้ดเก่าที่ยังไม่ย้ายมาใช้ key) ──
export const POSITION_OPTIONS = DEFAULT_POSITIONS.map(p => p.label_th)
