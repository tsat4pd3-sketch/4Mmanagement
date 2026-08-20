/* ══════════════════════════════════════════════════════════════════════
   ฝ่าย (division) — ชั้นบนสุดของผังองค์กร + ขอบเขตสกิล 2 ระดับ (2026-08-18)

   ที่มา: ช่างแผนก MTN เปิดโมดัลแก้ไขพนักงานแล้วเจอสกิลฝ่ายผลิต 29 ตัวขึ้น
   "ไม่เกี่ยวข้อง" → user สั่งให้แยกสกิลเป็น 2 ระดับ: ฝ่าย → (เจาะจงส่วนงานได้)

   ⚠️ ผังองค์กร **ไม่มีชั้นฝ่ายเป็น node** โดยตั้งใจ — ระดับบนสุดคือ ส่วนงาน
      (PD1-4, Planning&Store) กับ แผนกขึ้นตรงฝ่าย (MTN, JIG MTN, DIE MTN, QA)
      การแทรก node ชั้นใหม่จะไปพัง cascade section→department ทุกหน้า
      → ใช้ "ติดป้าย `org_nodes.division` ที่ node ระดับบนสุด แล้วลูกตกทอด"
        (หลักเดียวกับ cost_center / head_name ที่ไลน์ลูกตกทอดจากไลน์แม่)

   ⚠️ ห้ามเดาฝ่ายจากชื่อ section/department — ให้ยึดป้ายที่ผังองค์กรเสมอ
      (ชื่อเปลี่ยนได้ + โรงงานอื่นตอน rollout เรียกไม่เหมือนกัน)
   ══════════════════════════════════════════════════════════════════════ */
import { supabase } from '../supabaseClient'

/* fallback ตอนตารางยังไม่ apply / โหลดไม่ทัน — ต้องตรงกับ seed ใน migration */
export const DEFAULT_DIVISIONS = [
  { code: 'production',  label: 'ฝ่ายผลิต',        icon: '🏭', color: '#22c55e', sort_order: 10 },
  { code: 'maintenance', label: 'ฝ่ายช่าง',        icon: '🔧', color: '#f97316', sort_order: 20 },
  { code: 'quality',     label: 'ฝ่ายคุณภาพ',      icon: '✅', color: '#3b82f6', sort_order: 30 },
  { code: 'logistic',    label: 'ฝ่ายวางแผน-คลัง', icon: '📦', color: '#a855f7', sort_order: 40 },
  { code: 'office',      label: 'ฝ่ายสำนักงาน',    icon: '🗂️', color: '#94a3b8', sort_order: 50 },
]

let _cache = null
let _inflight = null
export function clearDivisionsCache() { _cache = null; _inflight = null }

export async function loadDivisions() {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = (async () => {
    try {
      const { data } = await supabase.from('org_divisions').select('*')
        .eq('is_active', true).order('sort_order')
      _cache = (data && data.length) ? data : DEFAULT_DIVISIONS
    } catch { _cache = DEFAULT_DIVISIONS }
    _inflight = null
    return _cache
  })()
  return _inflight
}
/** อ่านแบบ sync จาก cache (ต้องเรียก loadDivisions() มาก่อน) */
export const divisionsSync = () => _cache || DEFAULT_DIVISIONS
export const divisionMeta = (code) =>
  divisionsSync().find(d => d.code === code) || null
export const divisionLabel = (code) => divisionMeta(code)?.label || code || ''

const norm = (v) => String(v ?? '').trim().toLowerCase()

/** ฝ่ายของ node หนึ่ง — ไม่ได้ติดป้ายเอง = ตกทอดจากแม่ (กัน loop ที่ 10 ชั้น) */
export function divisionOfNode(nodeId, orgNodes) {
  if (!nodeId || !orgNodes?.length) return null
  const byId = new Map(orgNodes.map(n => [n.id, n]))
  let cur = byId.get(nodeId)
  for (let i = 0; cur && i < 10; i++) {
    if (cur.division) return cur.division
    cur = cur.parent_id ? byId.get(cur.parent_id) : null
  }
  return null
}

/** ฝ่ายของพนักงาน 1 คน — ยึด section ก่อน ไม่มีค่อยดู department
 *  (ช่าง MTN/JIG/DIE และ QA อยู่แผนก "ขึ้นตรงฝ่าย" → section เป็น null โดยตั้งใจ) */
export function divisionOfEmployee(emp, orgNodes) {
  if (!emp || !orgNodes?.length) return null
  const sec = norm(emp.section)
  const dep = norm(emp.department)
  if (sec) {
    const n = orgNodes.find(x => x.kind === 'section' && norm(x.code || x.name) === sec)
    const d = n && divisionOfNode(n.id, orgNodes)
    if (d) return d
  }
  if (dep) {
    const n = orgNodes.find(x => x.kind === 'department' && norm(x.code || x.name) === dep)
    const d = n && divisionOfNode(n.id, orgNodes)
    if (d) return d
  }
  return null
}

/** หน่วยงานที่ "เจาะจงได้" ใต้ฝ่ายหนึ่ง — ส่วนงาน + แผนกขึ้นตรงฝ่าย
 *  ⚠️ ฝ่ายช่าง/คุณภาพ ไม่มี section เลย (MTN/JIG MTN/DIE MTN/QA เป็น department
 *     ที่ parent_id เป็น null) → ต้องรวม department ระดับบนสุดด้วย ไม่งั้นเจาะจงอะไรไม่ได้ */
export function scopeUnitsForDivision(divisionCode, orgNodes) {
  if (!divisionCode || !orgNodes?.length) return []
  const out = []
  orgNodes.forEach(n => {
    if (n.kind !== 'section' && !(n.kind === 'department' && !n.parent_id)) return
    if (divisionOfNode(n.id, orgNodes) !== divisionCode) return
    const label = n.code || n.name
    if (label && !out.includes(label)) out.push(label)
  })
  return out
}

/** สกิลนี้อยู่ในขอบเขตของพนักงานคนนี้ไหม
 *    scope_division ว่าง            → ทุกฝ่าย (สกิลกลาง)
 *    scope_division ตรง             → ทั้งฝ่าย
 *    + scope_section ตรงด้วย        → เจาะจงหน่วยงาน
 *  ⚠️ ระดับเจาะจงเทียบกับ **section หรือ department** — พนักงานฝ่ายช่าง/คุณภาพ
 *     มี section เป็น null (สังกัดแผนกขึ้นตรงฝ่าย) เทียบ section อย่างเดียวจะไม่มีวันตรง
 *  ⚠️ สกิลที่มี scope_section แต่ไม่มี scope_division = ข้อมูลเก่า
 *     ให้เทียบด้วยหน่วยงานอย่างเดียว (backward-compatible ห้ามตกหล่น) */
export function skillInScope(skill, { division, section, department } = {}) {
  const sDiv = (skill?.scope_division || '').trim()
  const sSec = (skill?.scope_section || '').trim()
  if (!sDiv && !sSec) return true
  if (sDiv && norm(sDiv) !== norm(division)) return false
  if (sSec && norm(sSec) !== norm(section) && norm(sSec) !== norm(department)) return false
  return true
}

/** ข้อความอธิบายขอบเขตสกิล ใช้โชว์บนป้าย/ลิสต์ */
export function skillScopeLabel(skill) {
  const sDiv = (skill?.scope_division || '').trim()
  const sSec = (skill?.scope_section || '').trim()
  if (!sDiv && !sSec) return 'ทุกฝ่าย'
  const dv = sDiv ? divisionLabel(sDiv) : ''
  if (sDiv && sSec) return `${dv} · ${sSec}`
  return sSec || dv
}
