/* ── 🔩 ตัวโหลดข้อมูล "อะไหล่ของแผน PM" (2026-10-08) ─────────────────────────────
   แยกจากสูตร (`src/utils/pmSpares.js` = pure + เทส) — ไฟล์นี้แค่ดึงข้อมูลแล้วส่งต่อ
   ⚠️ ความต้องการอะไหล่คิด "ทั้งโรงงาน" เสมอ ไม่ใช่เฉพาะทีมที่จอเปิดอยู่
      (คลังอะไหล่ใช้ร่วมกัน — คิดเฉพาะทีมเดียว = ยอดต้องใช้ต่ำกว่าจริง แล้วของขาดตอนอีกทีมเบิก)
   ⚠️ วันครบกำหนดใช้ `resolvePlanDue()` ตัวเดียวกับจอ 3 ระดับ (กติกาเดียวกับแท็บแผน PM)
   ⚠️ ทุกคิวรีอ่าน error — ล้ม = คืน `error` ให้จอบอก "ตัวเลขไม่ครบ" ห้ามแสดงเหมือนไม่มีของต้องใช้ */
import { supabaseDR } from '../supabaseClient'
import fetchAllRows from '../utils/fetchAllRows'
import { fetchByIds } from '../utils/fetchByIds'
import { resolvePlanDue, cycleDaysOf } from './pmSchedule'
import { spareDemand, SPARE_HORIZON_DAYS } from '../utils/pmSpares'

export const PART_COLS = 'id, code, name, unit, stock_qty, min_qty, lead_time_days, shelf, is_active, category'

/** อะไหล่ที่ใช้ผูกแผน (ทุกตัวที่ยังใช้งาน + ตัวที่ถูกปิดแต่ยังอยู่ในแผน) */
export async function loadSpareParts() {
  return fetchAllRows(supabaseDR, 'mtn_spare_parts', PART_COLS, q => q.order('name').order('id'))
}

/** ความต้องการอะไหล่ของ PM ที่จะถึง ทั้งโรงงาน → { demand, error } */
export async function loadPmSpareDemand({ todayStr, horizonDays = SPARE_HORIZON_DAYS } = {}) {
  const errs = []
  const linesRes = await fetchAllRows(supabaseDR, 'pm_plan_spares', 'checklist_id, part_id, qty_per_pm',
    q => q.order('checklist_id').order('part_id'))
  if (linesRes.error) errs.push('รายการอะไหล่ของแผน')
  const lines = linesRes.data || []
  if (!lines.length) return { demand: spareDemand({ todayStr, horizonDays }), lines, error: errs[0] || null }

  const clIds = [...new Set(lines.map(l => l.checklist_id))]
  const [partsRes, clRes, planRes, insRes] = await Promise.all([
    fetchByIds([...new Set(lines.map(l => l.part_id))], ids => supabaseDR.from('mtn_spare_parts').select(PART_COLS).in('id', ids)),
    fetchByIds(clIds, ids => supabaseDR.from('checklists').select('id, name, frequency, equipment_id, department').in('id', ids)),
    fetchByIds(clIds, ids => supabaseDR.from('pm_plans').select('id, checklist_id, interval_days, next_due_date, last_done_at, cycle_basis, deferred_to, deferred_at, is_active').in('checklist_id', ids)),
    fetchByIds(clIds, ids => supabaseDR.from('inspections').select('id, checklist_id, inspected_at').in('checklist_id', ids).neq('approval_status', 'rejected')),
  ])
  if (partsRes.error) errs.push('ทะเบียนอะไหล่')
  if (clRes.error) errs.push('ใบตรวจ PM')
  if (planRes.error) errs.push('แผน PM')
  if (insRes.error) errs.push('ผลตรวจ')

  const eqIds = [...new Set((clRes.rows || []).map(c => c.equipment_id).filter(Boolean))]
  const jigRes = await fetchByIds(eqIds, ids => supabaseDR.from('jigs').select('id, name, jig_no, machine_no, line_name').in('id', ids))
  if (jigRes.error) errs.push('อุปกรณ์')
  const jigById = new Map((jigRes.rows || []).map(j => [j.id, j]))
  const planByCl = new Map((planRes.rows || []).map(p => [p.checklist_id, p]))
  const lastInsp = {}
  for (const i of insRes.rows || []) {
    if (!lastInsp[i.checklist_id] || i.inspected_at > lastInsp[i.checklist_id]) lastInsp[i.checklist_id] = i.inspected_at
  }

  const plans = (clRes.rows || []).map(cl => {
    const plan = planByCl.get(cl.id) || null
    const due = resolvePlanDue({ frequency: cl.frequency, plan, lastInspectedAt: lastInsp[cl.id] || null, todayStr })
    const eq = jigById.get(cl.equipment_id)
    return {
      checklistId: cl.id,
      name: [eq?.machine_no || eq?.jig_no, eq?.name || cl.name].filter(Boolean).join(' · ') || cl.name,
      lineName: eq?.line_name || '',
      department: cl.department,
      dueYmd: plan?.is_active === false ? null : due.dueYmd,
      cycleDays: cycleDaysOf(cl.frequency, plan?.interval_days),
      // นับจากวันเครื่องเดิน = ไม่มีวันครบตายตัว ⇒ ใช้รอบปฏิทินประมาณเผื่อ (ใช้จริง ≤ ค่านี้)
      estimate: plan?.cycle_basis === 'run_day',
    }
  })

  const demand = spareDemand({ plans, lines, parts: partsRes.rows || [], todayStr, horizonDays })
  return { demand, lines, plans, error: errs.length ? `โหลดไม่สำเร็จ: ${errs.join(' · ')}` : null }
}
