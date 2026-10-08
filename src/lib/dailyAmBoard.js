/* ── AM รายวัน (ผลิตตรวจเครื่องเองต้นกะ) — ตัวโหลด + ตัวสรุปต่อไลน์ ใช้ร่วมกันทุกจอ (2026-10-08) ──
   ก่อนหน้านี้ `/daily-checker?tab=pm` (DailyPM.jsx) เป็นเจ้าของ data-flow นี้คนเดียว ส่วนผังรวมโรงงาน
   (FactoryMap) อ่าน AM จาก `pm_plans.next_due_date` ⇒ หลัง migration 02/10 ที่ย้ายแผน AM รายวันไป
   `cycle_basis='run_day'` (ไม่มีวันครบกำหนดแบบปฏิทิน · `next_due_date = null`) ผังจึงขึ้น
   "AM ปกติ (N)" ตลอดกาล ไม่ว่าจะตรวจหรือไม่ (user ทัก 08/10: "สเตตัสไม่อัพเดท")

   🔴 คำตอบว่า "กะนี้ผลิตตรวจเครื่องแล้วหรือยัง" มีที่เดียว = ทะเบียน `pm_daily_line_targets`
      + ผลตรวจ `inspections` ของกะนี้ + เวลาเปิดใบผลิตใบแรก (`prod_orders.opened_at`)
      ตัดสินด้วย `computeDailyPmStatus()` (`src/lib/pmDailyStatus.js`) **ห้ามคิดเองในหน้า**
   · ไฟล์นี้ = "โหลด + จัดกลุ่มต่อไลน์" · สูตรสี/หน้าต่าง 60 นาทียังอยู่ที่ pmDailyStatus.js ที่เดิม
   · ทุกจอที่โชว์ AM รายวัน (DailyPM · FactoryMap · จอถัดไป) ต้องเรียกจากที่นี่ — เขียนซ้ำ = วันหนึ่งสองจอตอบคนละสี */
import { supabaseDR } from '../supabaseClient'
import { fetchByIds } from '../utils/fetchByIds'
import { getLineFamilyNames } from '../utils/lineHierarchy'
import { SESSION_STATUSES_REAL } from '../utils/sessionStatus'
import { loadLinesRes } from '../utils/useProductionLines'
import { loadPmTeams, isAmTeam } from '../utils/pmTeams'
import { amShiftInfo, isDailyAmEquipment } from './pmDailyStatus'

// ส่วน pure (กะ · ขอบเขตอุปกรณ์ · สรุปต่อไลน์) อยู่ใน pmDailyStatus.js (ไม่แตะ supabase ⇒ เทสได้) — re-export ให้จอเรียกจากที่เดียว
export { amShiftInfo, isDailyAmEquipment, dailyAmTargetsByLine, dailyAmLineStatus } from './pmDailyStatus'

/**
 * โหลดวัตถุดิบของบอร์ด AM รายวันทั้งชุด (DR · anon) — คืน `{ ok:false, error }` เมื่อคิวรีไหนล้ม
 * 🔴 ผู้เรียกต้อง **คงค่าเดิมไว้** เมื่อ `ok:false` (ล้างเป็นว่าง = จอบอก "ไม่มีจุดตรวจ" ซึ่งเป็นคำตอบผิด)
 * @param {Date} [now]
 * @param {Array} [lines] ทะเบียนไลน์ (ถ้าผู้เรียกมีอยู่แล้ว ไม่ต้องโหลดซ้ำ)
 */
export async function loadDailyAm({ now = new Date(), lines = null } = {}) {
  const si = amShiftInfo(now)
  const startISO = si.shiftStart.toISOString()
  await loadPmTeams().catch(() => {})   // ให้ isAmTeam อ่าน mtn_teams.kind ได้จริง (โหลดพลาด = fallback เดาจาก key)

  const [jigRes, tgRes, clRes, lineRes] = await Promise.all([
    supabaseDR.from('jigs').select('id, name, machine_no, line_name, jig_no, equipment_type, equipment_category').eq('module', 'mtn').order('line_name').order('name'),
    supabaseDR.from('pm_daily_line_targets').select('*').eq('is_active', true),
    // แยก AM / PM ด้วยแกนข้อมูล `mtn_teams.kind` — ห้าม hardcode `department === 'production'`
    supabaseDR.from('checklists').select('id, equipment_id, department').eq('module', 'mtn'),
    lines ? Promise.resolve({ data: lines, error: null }) : loadLinesRes(),   // คืน { data, error } · LINE_COLUMNS ครบตามสัญญา <LineSelect>
  ])
  const err = jigRes.error || tgRes.error || clRes.error || lineRes.error
  if (err) return { ok: false, error: err }

  const amChecklists = (clRes.data ?? []).filter(c => isAmTeam(c.department))
  const amEquipIds = new Set(amChecklists.map(c => c.equipment_id).filter(Boolean))
  const jigs = (jigRes.data ?? []).filter(j => isDailyAmEquipment(j, amEquipIds))
  const targets = tgRes.data ?? []

  // "ตรวจแล้วในกะนี้" = ใบตรวจของทีม AM ตั้งแต่เริ่มกะ · ล่าสุดชนะ (เรียง desc)
  const amClIds = new Set(amChecklists.map(c => c.id))
  const resultByJig = {}
  if (amClIds.size > 0) {
    const { data: insp, error: iErr } = await supabaseDR
      .from('inspections')
      .select('jig_id, status, checklist_id, inspected_at')
      .gte('inspected_at', startISO)
      .order('inspected_at', { ascending: false })
    if (iErr) return { ok: false, error: iErr }
    for (const i of insp ?? []) {
      if (!amClIds.has(i.checklist_id)) continue
      if (!resultByJig[i.jig_id]) resultByJig[i.jig_id] = { status: i.status }
    }
  }

  /* เวลาที่ "เริ่มผลิต" ของแต่ละไลน์กะนี้ → เริ่มนับนาฬิกา 60 นาที
     ⚠️ ต้องใช้ `opened_at` (เปิดใบ = เริ่มผลิต) **ไม่ใช่ `confirmed_at`** (ปิดใบ = ผลิตเสร็จ)
        feedback หน้างาน 2026-08-24: Daily Report เปิดกะเดินงานอยู่ แต่จอ AM ขึ้น "ยังไม่เริ่มผลิต" ทั้ง 7 ไลน์
     fallback ไป confirmed_at เผื่อใบเก่าที่ไม่มี opened_at */
  const { data: sessions, error: sErr } = await supabaseDR
    .from('production_sessions')
    .select('id, line_name')
    .eq('work_date', si.workDateStr)
    .eq('shift', si.shift)
    .in('status', SESSION_STATUSES_REAL)   // ใบโมฆะไม่ใช่กะจริง
  if (sErr) return { ok: false, error: sErr }
  const sessionLine = {}
  ;(sessions ?? []).forEach(s => { sessionLine[s.id] = s.line_name })
  const startedRaw = {}
  if (sessions?.length) {
    const oRes = await fetchByIds(sessions.map(s => s.id),
      c => supabaseDR.from('prod_orders').select('session_id, opened_at, confirmed_at').in('session_id', c))
    if (oRes.error) return { ok: false, error: oRes.error }
    for (const o of oRes.rows ?? []) {
      const line = sessionLine[o.session_id]
      const at = o.opened_at || o.confirmed_at
      if (!line || !at) continue
      if (!startedRaw[line] || at < startedRaw[line]) startedRaw[line] = at
    }
  }
  /* ⚠️ ไลน์แม่-ไลน์ลูกต้องนับรวมกัน — อุปกรณ์ลงทะเบียน AM ไว้ที่ไลน์แม่ HYDROFORM แต่กะเปิดที่ไลน์ลูก HDF1/HDF2
     เทียบชื่อไลน์ตรงตัว = การ์ด HYDROFORM ค้าง "ยังไม่เริ่มผลิต" ตลอดกาล */
  const linesForFam = lineRes.data ?? []
  const firstOrderByLine = {}
  for (const l of linesForFam) {
    const fam = getLineFamilyNames(linesForFam, l.id)
    const names = fam?.length ? fam : [l.name]
    for (const n of names) {
      const at = startedRaw[n]
      if (at && (!firstOrderByLine[l.name] || at < firstOrderByLine[l.name])) firstOrderByLine[l.name] = at
    }
  }
  // ชื่อไลน์ที่มี session แต่ไม่มีในทะเบียนไลน์ (เช่นเปิดกะด้วยชื่อเครื่อง) — ต้องไม่หายไป
  for (const [n, at] of Object.entries(startedRaw)) if (!firstOrderByLine[n]) firstOrderByLine[n] = at

  return {
    ok: true, shift: si, jigs, targets, lines: linesForFam, resultByJig, firstOrderByLine,
    openSessionLines: new Set(Object.values(sessionLine)),
  }
}
