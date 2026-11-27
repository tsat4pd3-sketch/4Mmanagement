/* 📈 ตัวโหลดข้อมูล SPC อุปกรณ์ (26/11) — กติกา/สูตรอยู่ src/utils/equipSpc.js + src/utils/spcCalc.js
   🔴 อ่านไม่ได้ = คืน error ให้จอเขียนบอก ห้ามกลืนเป็น "ไม่มีข้อมูล" · เลือกเฉพาะคอลัมน์ที่ใช้ (egress)
   📄 docs/modules/equipment-spc.md */
import { supabaseDR } from '../supabaseClient'
import { fetchByIds } from '../utils/fetchByIds'
import { readingsOf } from '../utils/equipSpc'
import { amSlotOf } from './amMonthly'

const CP_COLS = 'id, name, type, unit, lsl, usl, jig_id, checklist_id, spc_enabled, group_name, sort_order'

/** ข้อตัวเลขที่เปิด SPC ของทีมหนึ่ง + จำนวนจุดที่มี (ย้อน `days` วัน)
 *  @returns {Promise<{ ok:boolean, cps:object[], countByCp:Object<string,number>, error?:string }>} */
export async function loadSpcCatalog({ department, days = 180 } = {}) {
  if (!department) return { ok: true, cps: [], countByCp: {} }
  const { data: cls, error: e1 } = await supabaseDR.from('checklists').select('id').eq('module', 'mtn').eq('department', department)
  if (e1) return { ok: false, cps: [], countByCp: {}, error: e1.message }
  const clIds = (cls || []).map(c => c.id)
  if (!clIds.length) return { ok: true, cps: [], countByCp: {} }
  const r = await fetchByIds(clIds, c => supabaseDR.from('jig_checkpoints').select(CP_COLS).in('checklist_id', c)
    .in('type', ['variable', 'measure']).eq('spc_enabled', true))
  if (r.error) return { ok: false, cps: [], countByCp: {}, error: String(r.error) }
  const cps = r.rows || []
  if (!cps.length) return { ok: true, cps, countByCp: {} }
  const since = new Date(Date.now() - days * 86400e3).toISOString()
  const cr = await fetchByIds(cps.map(c => c.id), c => supabaseDR.from('inspection_results')
    .select('id, checkpoint_id, inspections!inner(inspected_at)').in('checkpoint_id', c)
    .gte('inspections.inspected_at', since).or('value_1.not.is.null,value_numeric.not.is.null'))
  const countByCp = {}
  for (const x of cr.rows || []) countByCp[x.checkpoint_id] = (countByCp[x.checkpoint_id] || 0) + 1
  return { ok: true, cps, countByCp, countError: cr.error ? String(cr.error) : null }
}

/** ค่าวัดของข้อเดียว เรียงเก่า→ใหม่ → แถว subgroup ของ equipSpc() */
export async function loadSpcSeries(cp, { days = 180 } = {}) {
  if (!cp?.id) return { ok: true, rows: [] }
  const since = new Date(Date.now() - days * 86400e3).toISOString()
  const r = await fetchByIds([cp.id], c => supabaseDR.from('inspection_results')
    .select('id, value_1, value_2, value_3, value_numeric, inspections!inner(inspected_at)').in('checkpoint_id', c)
    .gte('inspections.inspected_at', since))
  if (r.error) return { ok: false, rows: [], error: String(r.error) }
  const rows = (r.rows || [])
    .map(x => ({ at: x.inspections?.inspected_at, readings: readingsOf(cp, x) }))
    .filter(x => x.at && x.readings.length)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map(x => ({ ...x, work_date: amSlotOf(x.at)?.workDate || String(x.at).slice(0, 10) }))
  return { ok: true, rows }
}

/** จุดชิมที่มีประวัติ + ประวัติของจุด (ค่าชิมรวมหลังทำ = shim_after_mm) */
export async function loadShimCatalog() {
  const { data, error } = await supabaseDR.from('fixture_points').select('id, point_no, name, machine_id, max_shim_mm, current_shim_mm').eq('is_active', true)
  if (error) return { ok: false, points: [], countByPoint: {}, error: error.message }
  const ids = (data || []).map(p => p.id)
  const ev = ids.length ? await fetchByIds(ids, c => supabaseDR.from('fixture_shim_events').select('id, point_id').in('point_id', c)) : { rows: [] }
  const countByPoint = {}
  for (const e of ev.rows || []) countByPoint[e.point_id] = (countByPoint[e.point_id] || 0) + 1
  return { ok: !ev.error, points: data || [], countByPoint, error: ev.error ? String(ev.error) : null }
}

export async function loadShimEvents(pointId) {
  const { data, error } = await supabaseDR.from('fixture_shim_events').select('id, shim_after_mm, event_at, created_at').eq('point_id', pointId).order('event_at')
  if (error) return { ok: false, events: [], error: error.message }
  return { ok: true, events: data || [] }
}
