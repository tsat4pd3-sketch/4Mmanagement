// ทีมช่างซ่อมบำรุง (data-driven จากตาราง mtn_teams) — เลิก hardcode ชื่อทีม/แผนกในโค้ด
// key = checklists.department · label = ชื่อแสดงผล · equip_type = ประเภท default (fallback หน้า Check)
// โหลดครั้งเดียว cache ใน memory · มี DEFAULT_TEAMS เป็น fallback (migration ยังไม่ apply / โหลดพลาด)
import { supabaseDR } from '../supabaseClient'

export const DEFAULT_TEAMS = [
  { key: 'maintenance',     label: 'MTN (ซ่อมบำรุง)',   icon: '🔧', equip_type: 'machine', dept_name: 'MTN',        color: '#fb923c', sort_order: 1 },
  { key: 'jig_maintenance', label: 'JIG MTN',           icon: '🧩', equip_type: 'jig',     dept_name: 'JIG MTN',    color: '#34d399', sort_order: 2 },
  { key: 'die_maintenance', label: 'DIE MTN',           icon: '🗜️', equip_type: 'die',     dept_name: 'DIE MTN',    color: '#4d9fff', sort_order: 3 },
  { key: 'production',      label: 'AM (ผลิตตรวจเอง)',   icon: '🏭', equip_type: null,      dept_name: 'PRODUCTION', color: '#3dd65c', sort_order: 4 },
]

/**
 * AM vs PM — คนละเรื่องกันตามศัพท์ TPM (คำสั่ง user 2026-08-05)
 *   production   = AM (Autonomous Maintenance) — พนักงานผลิตดูแล/ตรวจเครื่องเองทุกต้นกะ
 *   ทีมช่างที่เหลือ = PM (Preventive/Predictive) — ช่างตรวจตามรอบเวลา/ยอดผลิต (อนาคต prescriptive)
 * key ใน DB ยังเป็น 'production' เหมือนเดิม เปลี่ยนเฉพาะการแสดงผล/คำอธิบาย
 * — จุดใดที่โชว์ชื่อทีม ให้เรียก teamKind() มาอธิบาย ห้าม hardcode คำว่า "PM ฝ่ายผลิต" อีก
 */
export const AM_KIND = {
  short: 'AM', full: 'Autonomous Maintenance',
  desc: 'พนักงานผลิตตรวจ/ดูแลเครื่องเองทุกต้นกะ — คนละส่วนกับ PM ของช่าง',
}
export const PM_KIND = {
  short: 'PM', full: 'Preventive / Predictive Maintenance',
  desc: 'ช่างตรวจตามรอบเวลา / ตามยอดผลิต — คนละส่วนกับ AM ที่ผลิตตรวจเองรายวัน',
}
export function teamKind(key) { return key === 'production' ? AM_KIND : PM_KIND }

let _cache = null
let _inflight = null

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
