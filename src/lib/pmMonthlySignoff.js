/**
 * pmMonthlySignoff — 📅 ใบ PM ของช่าง: โหลดข้อมูลรายเดือน + ลงนาม ③④ (2026-11-19 · คำสั่ง user)
 * กฎทั้งหมด = `src/utils/pmMonthly.js` (pure · มีเทส) · ไฟล์นี้แตะ DB อย่างเดียว
 *   · ใบตรวจ/ทีม/เครื่อง = DR (`inspections` · `checklists` · `jigs` · `mtn_teams`)
 *   · ลายเซ็น/ผัง/มอบหมาย = Main (`pm_monthly_signoffs` · `org_nodes` · `org_assignments`)
 * 🔴 ทุกตัวโหลดคืน `{ ok, error }` — อ่านไม่ได้ต้องให้จอเขียนบอก **ห้ามคืน [] แล้วจอโชว์ "ไม่มี"**
 * 🔴 ลงนาม: ผู้เรียกต้องคิด `verdict` ใหม่ตอนกด (`pmMonthlySignVerdict`) แล้วส่งมา — ไม่ ok = ไม่เขียน
 * 🔴 ห้ามลบ — เพิกถอน = status 'revoked' + เหตุผล ≥ 5 ตัวอักษร (ฐานมี trigger ล็อกเนื้อแถว)
 */
import { supabase, supabaseDR } from '../supabaseClient'
import { toast } from '../components/Toast'
import { checkWriteRows } from '../utils/dbWrite'
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds'
import { amMonthRange } from './amMonthly'
import { isAmTeam } from '../utils/pmTeams'
import { pmMonthlySignText, PM_REVOKE_REASON_MIN, KIND_OF_STEP, scopeKeyOf } from '../utils/pmMonthly'

export const PM_SIGNOFF_TABLE = 'pm_monthly_signoffs'
/* 🔴 โครงตาราง = ของ migration 20261113c (สร้างไว้ก่อน · kind/scope_key) — แปลงขั้น↔kind ที่ utils/pmMonthly.js
   ไม่มีคอลัมน์ "ได้สิทธิ์จากหน่วยไหน" ⇒ เก็บใน snapshot.via (head/acting + โหนด) */
const COLS = 'id, month, kind, scope_key, snapshot, signed_by, signed_by_name, position, signature_url, signed_at, note, status, revoked_by_name, revoked_at, revoke_reason'

const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205'
  || (/pm_monthly_signoffs/.test(String(e.message || '')) && /does not exist|could not find/i.test(String(e.message || ''))))

/**
 * ใบ PM (ทีมช่าง ไม่รวม AM) ของเดือน — วันงานโรงงาน 08:00 → 08:00 (ช่วงเดียวกับรายงาน AM)
 * @returns `{ ok, rows:[{ id, jig_id, status, approval_status, inspector_id, team }], lineOfJig:Map, error }`
 */
export async function loadPmMonthInspections(month) {
  const range = amMonthRange(month)
  if (!range) return { ok: false, rows: [], lineOfJig: new Map(), error: 'เดือนไม่ถูกต้อง' }
  const cl = await supabaseDR.from('checklists').select('id, department').eq('module', 'mtn')
  if (cl.error) return { ok: false, rows: [], lineOfJig: new Map(), error: cl.error.message }
  const deptOf = new Map((cl.data || []).filter(c => c.department && !isAmTeam(c.department)).map(c => [c.id, c.department]))
  const ids = [...deptOf.keys()]
  if (!ids.length) return { ok: true, rows: [], lineOfJig: new Map(), error: null }
  const ins = await fetchAllPages(() => supabaseDR.from('inspections')
    .select('id, jig_id, status, approval_status, inspector_id, checklist_id, inspected_at')
    .gte('inspected_at', range.from).lt('inspected_at', range.to)
    .in('checklist_id', ids))
  if (ins.error) return { ok: false, rows: [], lineOfJig: new Map(), error: ins.error }
  if (ins.truncated) return { ok: false, rows: [], lineOfJig: new Map(), error: 'ใบตรวจเดือนนี้เยอะเกินกว่าจะโหลดครบ' }
  const rows = ins.rows.map(r => ({ ...r, team: deptOf.get(r.checklist_id) || null })).filter(r => r.team)
  const jigIds = [...new Set(rows.map(r => r.jig_id).filter(v => v != null))]
  const jr = jigIds.length
    ? await fetchByIds(jigIds, chunk => supabaseDR.from('jigs').select('id, line_name').in('id', chunk))
    : { rows: [], error: null }
  if (jr.error) return { ok: false, rows: [], lineOfJig: new Map(), error: `อ่านทะเบียนเครื่องไม่ได้: ${jr.error}` }
  return { ok: true, rows, lineOfJig: new Map((jr.rows || []).map(j => [j.id, j.line_name || null])), error: null }
}

/** ผังองค์กร + มอบหมายของบัญชีนี้ — ใช้ตัดสินว่า "ครอบหน่วยไหม" (อ่านไม่ได้ = ok:false ⇒ ห้ามเซ็น) */
export async function loadOrgForSign(userId) {
  const [nodes, asg] = await Promise.all([
    supabase.from('org_nodes').select('id, kind, code, name, parent_id, is_active').eq('is_active', true),
    userId
      ? supabase.from('org_assignments').select('id, org_node_id, kind, starts_on, ends_on').eq('profile_id', userId)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (nodes.error || asg.error) return { ok: false, nodes: [], assignments: [], error: (nodes.error || asg.error).message }
  return { ok: true, nodes: nodes.data || [], assignments: asg.data || [], error: null }
}

/** ลายเซ็นของเดือน (ทั้งมีผลและเพิกถอนแล้ว) */
export async function loadPmMonthlySignoffs(month) {
  const { data, error } = await supabase.from(PM_SIGNOFF_TABLE).select(COLS)
    .eq('month', month).order('signed_at', { ascending: false })
  if (error) return { ok: false, rows: [], missing: isMissingTable(error), error: error.message || String(error) }
  return { ok: true, rows: data || [], missing: false, error: null }
}

/** ลงนาม ③ หรือ ④ — คืน true เมื่อเขียนติดจริง (นับแถวแล้ว) */
export async function signPmMonthly({ verdict, teamLabel, month, teamKey, step, section = null, snapshot,
  userId, fullName, position, signatureUrl }) {
  if (!verdict?.ok) { toast.error(pmMonthlySignText(verdict, { teamLabel, section }) || 'ลงนามไม่ได้'); return false }
  if (!snapshot || !userId) { toast.error('ลงนามไม่ได้ — ยังไม่มีสรุปของชุดนี้ หรือยังไม่รู้ตัวตนผู้ลงนาม'); return false }
  const res = await supabase.from(PM_SIGNOFF_TABLE).insert({
    month, kind: KIND_OF_STEP[step], scope_key: scopeKeyOf(teamKey, step, section),
    snapshot: { ...snapshot, team: teamKey, section: step === 4 ? section : null,
      via: verdict.via ? { kind: verdict.via.kind, org_node_id: verdict.via.nodeId } : null },
    signed_by: userId, signed_by_name: fullName || null, position: position || null,
    signature_url: signatureUrl || null,
  }).select('id')
  if (res.error?.code === '23505') { toast.error('ชุดนี้มีคนลงนามไปแล้ว — รีเฟรชหน้าเพื่อดูผู้ลงนาม'); return false }
  if (isMissingTable(res.error)) { toast.error('ระบบลงนาม PM รายเดือนยังไม่เปิดใช้ (ยังไม่ได้สร้างตาราง) — แจ้งผู้ดูแลระบบ'); return false }
  return checkWriteRows(res, 'ลงนาม PM รายเดือน')
}

/** เพิกถอน — เหตุผลบังคับ · ห้ามลบแถว */
export async function revokePmMonthly({ row, reason, fullName }) {
  const why = String(reason || '').trim()
  if (why.length < PM_REVOKE_REASON_MIN) { toast.error(`ระบุเหตุผลการเพิกถอนอย่างน้อย ${PM_REVOKE_REASON_MIN} ตัวอักษร`); return false }
  return checkWriteRows(await supabase.from(PM_SIGNOFF_TABLE)
    .update({ status: 'revoked', revoke_reason: why, revoked_by_name: fullName || null })
    .eq('id', row.id).eq('status', 'signed').select('id'), 'เพิกถอนลายเซ็น PM รายเดือน')
}
