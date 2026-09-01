// ทีมช่างซ่อม 4 ส่วน + การจับคู่กับ section ของ user (2026-07-16)
//   ใช้แจกใบแจ้งซ่อม MO ให้ถูกทีม: คิวงานแยกทีม + default หน่วยงานตอนแจ้ง + แจ้งเตือน Telegram แยกห้อง
//   จับคู่จาก profiles.sections (ตามคำสั่ง user) — ผูกกับ section ของคน
import { pmTeamsSync, DEFAULT_TEAMS } from './pmTeams'

// ⚠️ ค่าที่ "เก็บลง DB" คือ key เสมอ (mtn_teams.key) — ชื่อ (dept_name) ใช้แสดงผลเท่านั้น
//    เหตุผล: ชื่อทีมเปลี่ยนได้ (เคยเปลี่ยน PRODUCTION → "AM (ผลิตตรวจเอง)") ถ้าเก็บชื่อ ข้อมูลเก่าจะกำพร้าทันที
//    หลักเดียวกับ role / process_type / line_type ทั้งระบบ
export const MTN_TEAMS = ['jig_maintenance', 'die_maintenance', 'maintenance', 'production']

// ── Single source: ทุกคอลัมน์ทีมเก็บเป็น key แล้ว (migration 20260806_unify_team_encoding)
//    helper ยัง normalize ชื่อ→key ต่อไป เพราะข้อมูลที่ export/พิมพ์ไว้ก่อนหน้า หรือที่คนกรอกมือ อาจยังเป็นชื่อ
//    ดึง mapping จาก mtn_teams ที่โหลดไว้ (pmTeamsSync) ก่อน แล้ว fallback DEFAULT_TEAMS (2026-07-30 · F8)
function teamRows() { const r = pmTeamsSync(); return (r && r.length) ? r : DEFAULT_TEAMS }
// ค่าใดๆ → mtn_teams.key (canonical) — จับได้ทั้งที่ส่ง key มาตรงๆ หรือส่ง dept_name (label)
export function teamKeyOf(v) {
  const s = String(v || '').trim(); if (!s) return ''
  const low = s.toLowerCase()
  const hit = teamRows().find(t => String(t.key || '').toLowerCase() === low || String(t.dept_name || '').toLowerCase() === low)
  return hit ? hit.key : low
}
// ค่าใดๆ → ชื่อทีมที่ใช้ "แสดงผล" (mtn_teams.dept_name) — ห้ามเอาไปเก็บลง DB
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
  if (s.includes('JIG')) return 'jig_maintenance'
  if (s.includes('DIE')) return 'die_maintenance'
  if (s === 'MTN' || s.includes('MAINT') || s.includes('ซ่อม')) return 'maintenance'
  return null
}

// รายชื่อทีมที่ user คนนี้สังกัด — [] = ไม่ผูกทีม (เห็นคิวทุกทีม)
//   1. explicitTeams (profiles.mtn_teams — ตั้งจาก AddUser ตรงๆ 2026-07-22) = source of truth ถ้ามี
//   2. fallback เดา JIG/DIE/MTN จาก sections (backward-compat กับ user เก่าที่ยังไม่ได้ตั้งทีม)
export function teamsForUser(explicitTeams, sections) {
  // normalize ก่อนกรอง — ข้อมูลเก่าเก็บเป็นชื่อ ("JIG MTN") ข้อมูลใหม่เก็บ key
  const valid = (Array.isArray(explicitTeams) ? explicitTeams : []).map(teamKeyOf).filter(t => MTN_TEAMS.includes(t))
  if (valid.length) return [...new Set(valid)]
  const set = new Set()
  for (const sec of sections || []) { const t = teamForSection(sec); if (t) set.add(t) }
  return [...set]
}

// ── มุมมองต่อทีมของ master list (2026-08-06) ────────────────────────────────
// หลักการ: ตัวตนอุปกรณ์ (machine id / jig id / ชื่อเครื่อง) = ของกลางชุดเดียวทุกทีมอ้างตรงกัน
//   แต่ "รายละเอียด" (ลักษณะปัญหา / ชนิดอุปกรณ์ / หมวดอะไหล่ / วิธีตรวจ) เป็นมุมมองเฉพาะทีม
// กติกา: คอลัมน์ team ของแถว master — **null/ว่าง = ใช้ร่วมทุกทีม (common)**
//   (pattern เดียวกับ lpa_questions.line_name null = ข้อ common)
export function inTeamScope(rowTeam, selectedTeam) {
  if (!selectedTeam) return true                       // ยังไม่เลือกทีม = เห็นทั้งหมด
  if (rowTeam === null || rowTeam === undefined || String(rowTeam).trim() === '') return true
  return teamKeyOf(rowTeam) === teamKeyOf(selectedTeam)
}
/** กรอง master list ตามทีมที่เลือก (แถว common ติดมาด้วยเสมอ)
 *  ⚠️ ใช้กับ "ใครแก้ได้" เท่านั้น — การ **มองเห็น** ในฟอร์มแจ้งซ่อมให้ใช้ `visibleToTeam` */
export const filterByTeam = (rows, selectedTeam, key = 'team') =>
  (rows || []).filter(r => inTeamScope(r?.[key], selectedTeam))

/* ═══ "ใครเห็น" ≠ "ใครเป็นเจ้าของ" (คำสั่ง user 2026-08-11) ═══════════════════
   ความจริงหน้างานที่ทำให้ต้องแยก 2 แกนนี้:
     · **ช่างฝ่ายผลิต (AM) เจอปัญหาก่อนใครเสมอ → ต้องเห็นทุกลักษณะปัญหา**
       (ถ้าให้ไปติ๊ก shared ทีละแถวจะตกหล่นแน่ จึงเป็นกฎในโค้ด ไม่ใช่ข้อมูล)
     · **DIE MTN แยกชัดเจน** — งานแม่พิมพ์ไม่เกี่ยวกับช่างส่วนอื่น
     · **JIG MTN ↔ MTN ทับซ้อนกัน** — มีแค่ JIG Fixture ที่เป็นของ JIG แน่ๆ
       เรื่องอื่นทับซ้อนในบางเคส → ต้องระบุ "ทีมอื่นที่เห็นด้วย" ได้รายแถว
   คอลัมน์: `team` = เจ้าของ (แก้ได้) · `shared_teams text[]` = ทีมอื่นที่เห็น (แก้ไม่ได้) */

/** ทีมที่เห็นทุกแถวเสมอ — ผลิตเป็นด่านแรกที่เจอปัญหา */
export const SEE_ALL_TEAMS = ['production']
export const seesEverything = (team) => SEE_ALL_TEAMS.includes(teamKeyOf(team))

/** แถวนี้ทีมที่เลือก "เห็น" ไหม (ไม่ได้แปลว่าแก้ได้) */
export function visibleToTeam(row, selectedTeam) {
  if (!selectedTeam) return true
  if (seesEverything(selectedTeam)) return true                 // AM เห็นหมด
  if (inTeamScope(row?.team, selectedTeam)) return true         // เจ้าของ หรือ common
  const shared = Array.isArray(row?.shared_teams) ? row.shared_teams : []
  return shared.map(teamKeyOf).includes(teamKeyOf(selectedTeam))
}
/** กรองลิสต์สำหรับ "แสดงให้เลือก" (ฟอร์มแจ้งซ่อม) — ต่างจาก filterByTeam ที่ใช้คุมสิทธิ์แก้ */
export const visibleForTeam = (rows, selectedTeam) =>
  (rows || []).filter(r => visibleToTeam(r, selectedTeam))

// ชนิดอุปกรณ์ → ทีม (ใช้เดา default ตอนแจ้งซ่อม)
//   ลำดับ: (1) ทีมที่ตั้งไว้บนแถว mtn_item_types.team = source of truth
//          (2) fallback เดาจากชื่อ JIG→JIG MTN, DIE→DIE MTN, อื่น→MTN (ของเดิม ใช้เมื่อยังไม่ตั้งทีม)
//   itemRows = แถวจาก mtn_item_types (ไม่ส่งมา = ใช้การเดาจากชื่อล้วน — backward-compatible)
export const teamForItem = (it, itemRows = null) => {
  const s = (it || '').toUpperCase()
  if (Array.isArray(itemRows)) {
    const hit = itemRows.find(r => String(r?.name || '').toUpperCase() === s)
    if (hit?.team) return teamKeyOf(hit.team)
  }
  if (s.includes('JIG')) return 'jig_maintenance'
  if (s.includes('DIE')) return 'die_maintenance'
  return 'maintenance'
}

/* ชนิดอุปกรณ์ (machines.equipment_kind) → ทีมที่ "ปกติ" ดูแล — ใช้จัดคิวบนจอห้องช่างเท่านั้น
   ⚠️ เป็นการ **เดา** ไม่ใช่ข้อเท็จจริง — ตัวตัดสินจริงว่าใครรับผิดชอบคือ `mtn_orders.mtn_dept`
      (ใบซ่อม) และ `checklists.department` (งานตรวจ) ตามกฎเหล็ก "ชนิดอุปกรณ์ไม่ได้ล็อกว่าใครตรวจ"
   → จอที่กรองด้วยตัวนี้ **ห้ามซ่อนของที่กรองออกเงียบ** ต้องบอกจำนวนเสมอ */
export const teamForEquipmentKind = (kind) => {
  const k = String(kind || '').trim()
  if (k === 'die') return 'die_maintenance'
  if (k === 'jig') return 'jig_maintenance'
  return 'maintenance'   // machine / facility / ไม่ระบุ
}

/** ทีมทั้งหมดสำหรับทำ dropdown — [{ key, name }] · value = key (เก็บลง DB) · name = ชื่อที่โชว์ */
export const teamOptions = () => teamRows().map(t => ({ key: t.key, name: t.dept_name || t.label || t.key }))
