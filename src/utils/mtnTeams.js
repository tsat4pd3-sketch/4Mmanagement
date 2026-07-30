// ทีมช่างซ่อม 4 ส่วน + การจับคู่กับ section ของ user (2026-07-16)
//   ใช้แจกใบแจ้งซ่อม MO ให้ถูกทีม: คิวงานแยกทีม + default หน่วยงานตอนแจ้ง + แจ้งเตือน Telegram แยกห้อง
//   จับคู่จาก profiles.sections (ตามคำสั่ง user) — ผูกกับ section ของคน
import { pmTeamsSync, DEFAULT_TEAMS } from './pmTeams'

export const MTN_TEAMS = ['JIG MTN', 'DIE MTN', 'MTN', 'PRODUCTION']

// ── Single source: ทีมช่างมี 2 encoding — label (mtn_dept / telegram_channels.team = "JIG MTN")
//    กับ key (checklists.department = "jig_maintenance") · ตาราง mtn_teams (key ↔ dept_name) เป็นตัวโยง
//    helper นี้ normalize ค่าใดๆ (label หรือ key) → canonical เพื่อให้เทียบ/กรอง/route ไม่สนว่าเก็บ encoding ไหน
//    ดึง mapping จาก mtn_teams ที่โหลดไว้ (pmTeamsSync) ก่อน แล้ว fallback DEFAULT_TEAMS (2026-07-30 · F8)
function teamRows() { const r = pmTeamsSync(); return (r && r.length) ? r : DEFAULT_TEAMS }
// ค่าใดๆ → mtn_teams.key (canonical) — จับได้ทั้งที่ส่ง key มาตรงๆ หรือส่ง dept_name (label)
export function teamKeyOf(v) {
  const s = String(v || '').trim(); if (!s) return ''
  const low = s.toLowerCase()
  const hit = teamRows().find(t => String(t.key || '').toLowerCase() === low || String(t.dept_name || '').toLowerCase() === low)
  return hit ? hit.key : low
}
// ค่าใดๆ → mtn_teams.dept_name (label ที่ใช้ใน mtn_dept / telegram_channels.team) — ไว้เขียน/แสดง
export function deptNameOf(v) {
  const s = String(v || '').trim(); if (!s) return ''
  const low = s.toLowerCase()
  const hit = teamRows().find(t => String(t.key || '').toLowerCase() === low || String(t.dept_name || '').toLowerCase() === low)
  return hit ? (hit.dept_name || hit.key) : s
}
// เทียบ 2 ค่าว่าเป็นทีมเดียวกันไหม (ไม่สน encoding key/label)
export function sameTeam(a, b) { return teamKeyOf(a) === teamKeyOf(b) }

// section string → ทีมช่าง (null = ไม่เข้าทีมซ่อมทีมใดชัดเจน เช่น QA/ธุรการ/ขาย → เห็นคิวทุกทีม)
// หมายเหตุ: จับเฉพาะ 3 ทีมซ่อมเฉพาะทาง (JIG/DIE/MTN) — ทีม PRODUCTION (autonomous) เลือกเองตอนแจ้ง
//   เพราะ section ฝ่ายผลิตมีหลายชื่อ (PD1/PD2/GOR/...) เดาเป็น PRODUCTION เหมาจะไปโดน QA/ธุรการด้วย
export function teamForSection(section) {
  const s = (section || '').toUpperCase().trim()
  if (!s) return null
  if (s.includes('JIG')) return 'JIG MTN'
  if (s.includes('DIE')) return 'DIE MTN'
  if (s === 'MTN' || s.includes('MAINT') || s.includes('ซ่อม')) return 'MTN'
  return null
}

// รายชื่อทีมที่ user คนนี้สังกัด — [] = ไม่ผูกทีม (เห็นคิวทุกทีม)
//   1. explicitTeams (profiles.mtn_teams — ตั้งจาก AddUser ตรงๆ 2026-07-22) = source of truth ถ้ามี
//   2. fallback เดา JIG/DIE/MTN จาก sections (backward-compat กับ user เก่าที่ยังไม่ได้ตั้งทีม)
export function teamsForUser(explicitTeams, sections) {
  const valid = (Array.isArray(explicitTeams) ? explicitTeams : []).filter(t => MTN_TEAMS.includes(t))
  if (valid.length) return [...new Set(valid)]
  const set = new Set()
  for (const sec of sections || []) { const t = teamForSection(sec); if (t) set.add(t) }
  return [...set]
}

// ชนิดอุปกรณ์ → ทีม (ใช้เดา default ตอนแจ้งซ่อม) — JIG→JIG MTN, DIE→DIE MTN, อื่น→MTN
export const teamForItem = (it) => {
  const s = (it || '').toUpperCase()
  if (s.includes('JIG')) return 'JIG MTN'
  if (s.includes('DIE')) return 'DIE MTN'
  return 'MTN'
}
