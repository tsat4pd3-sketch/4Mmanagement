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
import { cachedRows } from '../utils/masterCache'
import { fetchByIds } from '../utils/fetchByIds'
import { getLineFamilyNames } from '../utils/lineHierarchy'
import { SESSION_STATUSES_REAL } from '../utils/sessionStatus'
import { loadLinesRes } from '../utils/useProductionLines'
import { loadPmTeams, isAmTeam } from '../utils/pmTeams'
import { MO_DONE_STATUSES } from '../utils/mtnStepPerm'
import { amShiftInfo, isDailyAmEquipment, openFamilyLines, runningMachinesByLine, amCarryOverByJig } from './pmDailyStatus'
import { loadRunDays } from '../utils/runDays'
import { amMonthRange } from './amMonthly'

// ส่วน pure (กะ · ขอบเขตอุปกรณ์ · สรุปต่อไลน์) อยู่ใน pmDailyStatus.js (ไม่แตะ supabase ⇒ เทสได้) — re-export ให้จอเรียกจากที่เดียว
export { amShiftInfo, isDailyAmEquipment, dailyAmTargetsByLine, dailyAmLineStatus, amModeNote } from './pmDailyStatus'

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

  /* 🔴 3 ตัวแรกเป็น **ทะเบียน** (setup) ไม่ใช่ข้อมูลสด ⇒ ผ่าน cache (2026-10-13 · งานลด egress)
     วัดจริง 09/10: จอนี้ reload ทุกครั้งที่มี event ของ inspections/prod_orders/production_sessions
     ⇒ `jigs` 545 + `checklists` 497 + `pm_daily_line_targets` 266 = **1,308 ครั้ง/วัน**
     ทั้งที่ 3 ตารางนี้เปลี่ยนเดือนละไม่กี่ครั้ง · บนจอ TV ที่เปิดค้างคือ**ทุก 10 นาทีตลอดคืน**
     🔴 ตัวเลขนี้คูณตามจำนวนจอที่เปิด — เป็นค่าใช้จ่ายที่โตตามการใช้งาน ไม่ใช่ตามงานที่ทำ
     ⚠️ ใช้ `cachedRows` (ไม่ใช่ `cachedMaster`) เพราะบอร์ดนี้ **"โหลดพลาด" ต้องไม่กลายเป็น "ว่าง"**
        — ว่าง = จอขึ้น "ไม่มีจุดตรวจ" = คำตอบผิดที่ดูเหมือนคำตอบถูก (ดูหัวไฟล์ ข้อ ok:false)
     🔑 แก้ทะเบียนแล้วต้องเห็นทันที → ทุกจุดที่เขียน 3 ตารางนี้เรียก `invalidateTable()` แล้ว */
  const [jigRes, tgRes, clRes, lineRes] = await Promise.all([
    cachedRows('jigs:am', () => supabaseDR.from('jigs').select('id, name, machine_no, line_name, jig_no, equipment_type, equipment_category').eq('module', 'mtn').order('line_name').order('name')),
    cachedRows('pm_daily_line_targets:active', () => supabaseDR.from('pm_daily_line_targets').select('*').eq('is_active', true)),
    // แยก AM / PM ด้วยแกนข้อมูล `mtn_teams.kind` — ห้าม hardcode `department === 'production'`
    cachedRows('checklists:mtn', () => supabaseDR.from('checklists').select('id, equipment_id, department').eq('module', 'mtn')),
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
      .select('id, jig_id, status, checklist_id, inspected_at')
      .gte('inspected_at', startISO)
      .order('inspected_at', { ascending: false })
    if (iErr) return { ok: false, error: iErr }
    for (const i of insp ?? []) {
      if (!amClIds.has(i.checklist_id)) continue
      if (!resultByJig[i.jig_id]) resultByJig[i.jig_id] = { status: i.status, id: i.id, inspected_at: i.inspected_at }
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
  const runOrders = []   // ⚙️ B1 — ใบผลิตกะนี้ + เลขเครื่อง ⇒ "เครื่องไหนต้องตรวจ AM" (runningMachinesByLine)
  if (sessions?.length) {
    const oRes = await fetchByIds(sessions.map(s => s.id),
      c => supabaseDR.from('prod_orders').select('session_id, opened_at, confirmed_at, machine_no').in('session_id', c))
    if (oRes.error) return { ok: false, error: oRes.error }
    for (const o of oRes.rows ?? []) {
      const line = sessionLine[o.session_id]
      const at = o.opened_at || o.confirmed_at
      if (line) runOrders.push({ line_name: line, machine_no: o.machine_no ?? null, at: at || null })
      if (!line || !at) continue
      if (!startedRaw[line] || at < startedRaw[line]) startedRaw[line] = at
    }
  }
  /* ⚠️ ไลน์แม่-ไลน์ลูกต้องนับรวมกัน — อุปกรณ์ลงทะเบียน AM ไว้ที่ไลน์แม่ HYDROFORM แต่กะเปิดที่ไลน์ลูก HDF1/HDF2
     เทียบชื่อไลน์ตรงตัว = การ์ด HYDROFORM ค้าง "ยังไม่เริ่มผลิต" ตลอดกาล */
  const linesForFam = lineRes.data ?? []
  const openRaw = new Set(Object.values(sessionLine))   // ชื่อที่เปิดกะ "ตรงตัว"
  const firstOrderByLine = {}
  /* 🔴 "ไลน์นี้เดินอยู่ไหม" ต้องไล่ไลน์แม่-ลูก ไม่ใช่เทียบชื่อตรงตัว — กฎ + เหตุผลอยู่ที่
     `openFamilyLines()` ใน `pmDailyStatus.js` (ฝั่ง pure · มีเทส) ห้ามวนเองที่นี่ */
  const openFam = openFamilyLines(linesForFam, openRaw)
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

  const runByLine = runningMachinesByLine(linesForFam, runOrders)
  // 🔧 B3 — ล้มได้โดยไม่ทำให้บอร์ดล้ม: `moFollow.ok=false` ⇒ จอเขียนว่า "อ่านสถานะใบซ่อมไม่ได้" (ไม่ใช่ "ยังไม่เปิดใบ")
  const moFollow = await loadAmMoFollow({ resultByJig, amClIds, shiftStart: si.shiftStart })

  return {
    ok: true, shift: si, jigs, targets, lines: linesForFam, resultByJig, firstOrderByLine,
    openSessionLines: openFam, runByLine, moFollow,
  }
}

/* 🔧 B3 (02/11) — ใบซ่อมของผลตรวจ AM: (ก) NG กะนี้ผูก MO หรือยัง (ข) MO จากผลตรวจ AM วันก่อนที่ยังไม่ปิด
   🔴 คอลัมน์ `mo_waived_reason` มาจาก migration ที่อาจยังไม่ apply ⇒ คิวรีแยก + ทน 42703 (บอกบนจอ ไม่ใช่ล้มทั้งบอร์ด)
   ป้ายสถานะ MO = `moStatusLabel()` ที่จอ — ที่นี่ select คอลัมน์ที่ป้ายต้องใช้ให้ครบ (ขาด = ป้ายถอยเป็นป้ายรวม ไม่เดา) */
export const AM_MO_COLS = 'id, mo_no, status, current_step, mtn_dept, item_type, purpose, dept_manager_at, plant_manager_at, mtn_head_at, approve_at, quality_related, qa_skipped_at, source_inspection_id, machine_no, report_at'
async function loadAmMoFollow({ resultByJig, amClIds, shiftStart }) {
  try {
    const failIds = Object.values(resultByJig).filter(r => r.status === 'fail' && r.id).map(r => r.id)
    const moByInsp = {}
    if (failIds.length) {
      const r = await fetchByIds(failIds, c => supabaseDR.from('mtn_orders').select(AM_MO_COLS).in('source_inspection_id', c))
      if (r.error) return { ok: false, error: r.error }
      for (const m of r.rows ?? []) moByInsp[m.source_inspection_id] = m
    }
    // เหตุผลที่ไม่เปิดใบ (คอลัมน์ใหม่) — ยังไม่ apply = ไม่มีข้อมูลส่วนนี้ (บอกบนจอ)
    const waiverByInsp = {}
    let waiverReady = true
    if (failIds.length) {
      const w = await fetchByIds(failIds, c => supabaseDR.from('inspections').select('id, mo_waived_reason').in('id', c))
      if (w.error) waiverReady = false
      else for (const x of w.rows ?? []) if (x.mo_waived_reason) waiverByInsp[x.id] = { reason: x.mo_waived_reason }
    }
    // ใบซ่อมที่ยังเปิดอยู่ซึ่งมาจากผลตรวจ (ทุกวัน) → กรองเหลือผลตรวจของทีม AM
    const { data: open, error: oErr } = await supabaseDR.from('mtn_orders').select(AM_MO_COLS)
      .not('source_inspection_id', 'is', null)
      .not('status', 'in', `(${MO_DONE_STATUSES.join(',')})`)
    if (oErr) return { ok: false, error: oErr }
    const ids = [...new Set((open ?? []).map(m => m.source_inspection_id))]
    const inspById = {}
    if (ids.length) {
      const r = await fetchByIds(ids, c => supabaseDR.from('inspections').select('id, jig_id, checklist_id, inspected_at').in('id', c))
      if (r.error) return { ok: false, error: r.error }
      for (const i of r.rows ?? []) if (amClIds.has(i.checklist_id)) inspById[i.id] = i
    }
    return { ok: true, moByInsp, waiverByInsp, waiverReady, carryByJig: amCarryOverByJig(open ?? [], inspById, shiftStart) }
  } catch (e) {
    return { ok: false, error: e }
  }
}

/**
 * 📅 วัตถุดิบของรายงาน AM รายเดือน (ประชุม 02/11 ข้อ C2 · 2026-11-03) — ประกอบตารางด้วย `buildAmMonthly()`
 * (`lib/amMonthly.js` · pure) · ทะเบียน 3 ตัวใช้ **cache คีย์เดียวกับบอร์ดรายวัน** (ไม่ดึงซ้ำ)
 *
 * 🔴 ทะเบียน/ใบตรวจล้ม = `{ ok:false }` ทั้งก้อน (ตารางไม่มีความหมายถ้าไม่รู้ว่าใครตรวจแล้ว)
 * 🔴 ตารางกะล้ม = `runsByKey: null` **ไม่ล้มทั้งก้อน** — จอวาด `?` (ไม่รู้ว่าผลิตไหม) แล้วเขียนจำนวนบนจอ
 *    ห้ามบีบเป็น "ไม่ได้ผลิต" (กลบวันขาดตรวจทั้งเดือน · กฎ `utils/dailyCheckDay.js` ข้อ 1)
 * · ใบตรวจ/ตารางกะแบ่งหน้าครบ (31 เครื่อง × 62 กะ เกิน 1000 แถวได้)
 * @param {{ month:string, lines?:object[] }} p
 */
export async function loadMonthlyAm({ month, lines = null } = {}) {
  const rg = amMonthRange(month)
  if (!rg) return { ok: false, error: { message: `เดือนไม่ถูกต้อง: ${month}` } }
  await loadPmTeams().catch(() => {})
  const [jigRes, tgRes, clRes, lineRes] = await Promise.all([
    cachedRows('jigs:am', () => supabaseDR.from('jigs').select('id, name, machine_no, line_name, jig_no, equipment_type, equipment_category').eq('module', 'mtn').order('line_name').order('name')),
    cachedRows('pm_daily_line_targets:active', () => supabaseDR.from('pm_daily_line_targets').select('*').eq('is_active', true)),
    cachedRows('checklists:mtn', () => supabaseDR.from('checklists').select('id, equipment_id, department').eq('module', 'mtn')),
    lines ? Promise.resolve({ data: lines, error: null }) : loadLinesRes(),
  ])
  const err = jigRes.error || tgRes.error || clRes.error || lineRes.error
  if (err) return { ok: false, error: err }

  const amChecklists = (clRes.data ?? []).filter(c => isAmTeam(c.department))
  const amEquipIds = new Set(amChecklists.map(c => c.equipment_id).filter(Boolean))
  const amClIds = [...new Set(amChecklists.map(c => c.id))]
  const linesAll = lineRes.data ?? []
  const targets = tgRes.data ?? []

  // ใบตรวจทีม AM ของเดือน (08:00 วันแรก → 08:00 วันแรกเดือนถัดไป · เวลาไทย) · pending ส่งไปด้วย ตัดสินที่ buildAmMonthly
  let inspections = []
  if (amClIds.length) {
    const r = await fetchByIds(amClIds, c => supabaseDR.from('inspections')
      .select('id, jig_id, status, inspected_at').in('checklist_id', c)
      .gte('inspected_at', rg.from).lt('inspected_at', rg.to))
    if (r.error) return { ok: false, error: { message: r.error } }
    inspections = r.rows ?? []
  }

  // วันที่เปิดกะจริงของไลน์ที่มีทะเบียน + ครอบครัว (แม่/ลูก) — ไล่ครอบครัวต่อใน buildAmMonthly
  const names = new Set()
  for (const t of targets) {
    if (!t.line_name) continue
    names.add(t.line_name)
    const l = linesAll.find(x => x.name === t.line_name)
    if (l) for (const n of getLineFamilyNames(linesAll, l.id) || []) names.add(n)
  }
  const runs = await loadRunDays({ lineNames: [...names], from: rg.first, to: rg.last })

  return {
    ok: true, month, range: rg, jigs: jigRes.data ?? [], amEquipIds, targets, lines: linesAll, inspections,
    runsByKey: runs.ok ? runs.byKey : null, runsError: runs.ok ? null : (runs.error?.message || String(runs.error)),
  }
}
