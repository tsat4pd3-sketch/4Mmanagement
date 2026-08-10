// ทีมช่างซ่อมบำรุง (data-driven จากตาราง mtn_teams) — เลิก hardcode ชื่อทีม/แผนกในโค้ด
// key = checklists.department · label = ชื่อแสดงผล · equip_type = ประเภท default (fallback หน้า Check)
// โหลดครั้งเดียว cache ใน memory · มี DEFAULT_TEAMS เป็น fallback (migration ยังไม่ apply / โหลดพลาด)
import { supabaseDR } from '../supabaseClient'

export const DEFAULT_TEAMS = [
  { key: 'maintenance',     label: 'MTN (ซ่อมบำรุง)',   icon: '🔧', equip_type: 'machine', dept_name: 'MTN',        color: '#fb923c', sort_order: 1, kind: 'pm' },
  { key: 'jig_maintenance', label: 'JIG MTN',           icon: '🧩', equip_type: 'jig',     dept_name: 'JIG MTN',    color: '#34d399', sort_order: 2, kind: 'pm' },
  { key: 'die_maintenance', label: 'DIE MTN',           icon: '🗜️', equip_type: 'die',     dept_name: 'DIE MTN',    color: '#4d9fff', sort_order: 3, kind: 'pm' },
  { key: 'production',      label: 'AM (ผลิตตรวจเอง)',   icon: '🏭', equip_type: null,      dept_name: 'PRODUCTION', color: '#3dd65c', sort_order: 4, kind: 'am' },
]

/**
 * AM vs PM — คนละเรื่องกันตามศัพท์ TPM (คำสั่ง user 2026-08-05 · เป็นข้อมูลจริง 2026-08-06)
 *   AM (Autonomous Maintenance) — พนักงานหน้างานตรวจ/ดูแลเครื่องเองทุกต้นกะ
 *   PM (Preventive/Predictive)  — ช่าง (technician/engineer) ตรวจตามรอบเวลา/ยอดผลิต/เงื่อนไข
 *
 * ⚠️ แกนนี้อ่านจาก **ข้อมูล** (`mtn_teams.kind` = 'am'|'pm') ไม่ใช่เงื่อนไขในโค้ด
 *   — เดิม hardcode `key === 'production'` ซึ่งพังเงียบทันทีที่แยก AM รายส่วนงาน (AM-PD1/PD2)
 *     หรือ rollout โรงงานที่เรียกทีมคนละชื่อ (ทีมใหม่จะกลายเป็น PM โดยไม่มีใครรู้)
 *   — ตั้งค่าที่ตาราง `mtn_teams.kind` · ยังไม่ตั้ง/ยังไม่ apply migration = fallback เดาจาก key (พฤติกรรมเดิม)
 * จุดใดที่โชว์ชื่อทีม ให้เรียก teamKind() มาอธิบาย ห้าม hardcode คำว่า "PM ฝ่ายผลิต" อีก
 */
export const AM_KIND = {
  short: 'AM', full: 'Autonomous Maintenance',
  desc: 'พนักงานผลิตตรวจ/ดูแลเครื่องเองทุกต้นกะ — คนละส่วนกับ PM ของช่าง',
}
export const PM_KIND = {
  short: 'PM', full: 'Preventive / Predictive Maintenance',
  desc: 'ช่างตรวจตามรอบเวลา / ตามยอดผลิต — คนละส่วนกับ AM ที่ผลิตตรวจเองรายวัน',
}
/** ทีมนี้เป็นงาน AM หรือ PM — อ่าน mtn_teams.kind ก่อน แล้ว fallback เดาจาก key */
export function teamKindOf(key) {
  const row = (pmTeamsSync() || []).find(t => t.key === key)
  if (row?.kind === 'am' || row?.kind === 'pm') return row.kind
  return key === 'production' ? 'am' : 'pm'      // backward-compat: ยังไม่ apply migration / ยังไม่ตั้งค่า
}
export const isAmTeam = (key) => teamKindOf(key) === 'am'
export function teamKind(key) { return teamKindOf(key) === 'am' ? AM_KIND : PM_KIND }

/** สิทธิ์ที่ต้องมีเพื่อ "บันทึกผลตรวจ" ของทีมนี้ — AM กับ PM แยกแกนกัน (migration 20260806_am_pm_permission_axis)
 *  ใช้คู่กับ can(...) เช่น: const [res, act] = recordPermFor(dept); can(res, act, role) */
export const recordPermFor = (key) => (isAmTeam(key) ? ['am', 'record'] : ['pm', 'record'])

let _cache = null
let _inflight = null

/** ล้าง cache — เรียกหลังแก้ตาราง mtn_teams เพื่อให้ loadPmTeams() ดึงของใหม่ */
export function clearPmTeamsCache() { _cache = null; _inflight = null }

export async function loadPmTeams() {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = (async () => {
    try {
      const { data } = await supabaseDR.from('mtn_teams').select('*').eq('is_active', true).order('sort_order')
      _cache = (data && data.length) ? data : DEFAULT_TEAMS
    } catch { _cache = DEFAULT_TEAMS }
    _inflight = null
    return _cache
  })()
  return _inflight
}

// ค่าที่โหลดไว้ (sync) — ถ้ายังไม่โหลดคืน DEFAULT_TEAMS
export function pmTeamsSync() { return _cache || DEFAULT_TEAMS }
export function teamLabel(key) { return (pmTeamsSync().find(t => t.key === key) || {}).label || key }
export function teamEquipType(key) { return (pmTeamsSync().find(t => t.key === key) || {}).equip_type || null }
