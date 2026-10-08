// System 1 — Production Daily Preventive Maintenance status logic (pure).
// ⚠️ ไฟล์นี้ต้อง pure (ไม่ import supabase) — เทสใน src/lib/__tests__/dailyAmBoard.test.mjs · ตัวโหลดอยู่ dailyAmBoard.js
import { getWorkDate, getCurrentShift, shiftStartTime } from '../utils/workDate.js'
// One line × shift × work_date rolls up over the equipment registered in
// pm_daily_line_targets ("must be checked every shift"). Shared by the status
// dashboard and the orange-alarm scheduler so both agree on what each colour means.

// Grace window: a line may start production and still be within its allowed
// window to complete the daily check — no later than 1 hour after production starts.
//
// ⚠️ "production starts" = the first order is OPENED (prod_orders.opened_at),
//    NOT when it is confirmed/closed. Fixed 2026-08-24 after the floor reported
//    every line stuck on "ยังไม่เริ่มผลิต" while shifts were clearly running:
//    an order that takes hours to finish would keep the line idle all morning and
//    only then start a 60-min clock — the opposite of a start-of-shift AM check.
//    Both this dashboard and the pm-daily-scan edge function must use the same anchor.
export const DAILY_PM_WINDOW_MIN = 60

// Colours:
//   green   — every registered item checked, all pass
//   red     — at least one abnormal (NG) result (wins over incomplete)
//   orange  — window elapsed and still incomplete (checked < total)
//   pending — production started but still inside the grace window
//   idle    — line hasn't opened an order yet (nothing to check against)
//   none    — line has no registered daily-PM equipment
//
// @param targets  [{ jig_id, name, machine_no }]  registered equipment for the line/shift
// @param results  { [jig_id]: { status: 'pass'|'fail'|'pending', ngTopics: string[] } }
//                 latest inspection outcome for this shift/day, keyed by jig
// @param firstOrderAt  ISO string / Date of the first order OPENED this shift, or null
// @param now      reference time (defaults to current time)
export function computeDailyPmStatus({ targets = [], results = {}, firstOrderAt = null, windowMin = DAILY_PM_WINDOW_MIN, now } = {}) {
  const nowMs = (now ? new Date(now) : new Date()).getTime()
  const checked = []
  const missing = []
  const ng = []

  for (const t of targets) {
    const r = results[t.jig_id]
    if (!r || r.status === 'pending' || r.status == null) { missing.push(t); continue }
    checked.push(t)
    if (r.status === 'fail') ng.push({ ...t, topics: r.ngTopics ?? [] })
  }

  const total = targets.length
  const windowPassed = firstOrderAt != null &&
    (nowMs - new Date(firstOrderAt).getTime()) > windowMin * 60000

  let status
  if (total === 0)                     status = 'none'
  else if (ng.length > 0)              status = 'red'      // abnormal wins
  else if (checked.length === total)   status = 'green'    // complete & all pass
  else if (firstOrderAt == null)       status = 'idle'     // production not started
  else if (windowPassed)               status = 'orange'   // late & incomplete
  else                                 status = 'pending'  // still within window

  return {
    status,
    total,
    checked: checked.length,
    missing,          // [{ jig_id, name, machine_no }] not yet checked
    ng,               // [{ jig_id, name, machine_no, topics: [] }] abnormal
    firstOrderAt,
    windowPassed,
  }
}

export const DAILY_PM_STATUS_META = {
  green:   { label: 'ตรวจครบ ปกติ',     color: '#3dd65c' },
  red:     { label: 'พบความผิดปกติ',    color: '#e05c4a' },
  orange:  { label: 'ตรวจไม่ครบ (เกินเวลา)', color: '#f59a3f' },
  pending: { label: 'อยู่ในช่วงเวลาตรวจ', color: '#9b8de8' },
  idle:    { label: 'ยังไม่เริ่มผลิต',   color: '#527855' },
  none:    { label: 'ไม่มีรายการลงทะเบียน', color: '#6b7280' },
}

/* ── ส่วนที่ใช้ร่วมกันระหว่าง /daily-checker?tab=pm กับผังรวมโรงงาน (2026-10-08) ── */
/** กะปัจจุบัน + เวลาเริ่มกะ (Date) + วันทำงาน — ใช้ตัดสิน "ตรวจแล้วในกะนี้" (รับ `now` เพื่อเทส) */
export function amShiftInfo(now = new Date()) {
  const shift = getCurrentShift(now)
  const workDateStr = getWorkDate(now)
  const [y, m, d] = workDateStr.split('-').map(Number)
  const [hh, mm] = shiftStartTime(shift).split(':').map(Number)
  const shiftStart = new Date(y, m - 1, d, hh, mm, 0, 0)   // เวลาเครื่อง (= Asia/Bangkok ตอน deploy) ไม่ใช่ UTC
  return { shift, workDateStr, shiftStart, label: shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก' }
}

/* AM = operator ฝ่ายผลิตเช็ค "เครื่องผลิต" รายวัน → ตัด jig/die tooling + facility/utility ออกจากลิสต์
   ⚠️ แต่ "ชนิดอุปกรณ์ ไม่ได้ล็อกว่าใครเป็นคนตรวจ" (คำสั่ง user 2026-08-11) — ตัวที่ **มี checklist ของ AM อยู่แล้ว**
      ต้องโผล่เสมอ ไม่งั้นตั้งจุดตรวจ AM ที่ PM Setup ได้ แต่เครื่องไม่มีวันโผล่ให้ operator ตรวจ = ทางตัน */
export function isDailyAmEquipment(j, amEquipIds) {
  if (!j) return false
  if (amEquipIds?.has(j.id)) return true
  if (j.equipment_category === 'facility' || j.equipment_category === 'utility') return false
  if (j.equipment_type === 'jig' || j.equipment_type === 'die') return false
  return true   // machine / ไม่ระบุ (legacy) / production
}

/**
 * จัดกลุ่มทะเบียนจุดตรวจของกะนี้ต่อไลน์ — เฉพาะ target ที่ชี้อุปกรณ์ที่ยังอยู่ในขอบเขต AM
 * (target ที่ชี้อุปกรณ์ซึ่งเปลี่ยนชนิด/ย้ายหมวดไปแล้ว = ข้าม — เคสจริงใน mock audit)
 * @returns { [line_name]: [{ jig_id, name, machine_no }] }
 */
export function dailyAmTargetsByLine({ targets = [], jigs = [], shift } = {}) {
  const jigById = Object.fromEntries(jigs.map(j => [j.id, j]))
  const byLine = {}
  for (const t of targets) {
    if (t.shift && shift && t.shift !== shift) continue   // target เฉพาะกะอื่น
    const j = jigById[t.jig_id]
    if (!j) continue
    ;(byLine[t.line_name] ||= []).push({ jig_id: j.id, name: j.name, machine_no: j.machine_no })
  }
  return byLine
}

/**
 * สถานะ AM รายวันต่อไลน์ (pure) — ผลลัพธ์ของ `computeDailyPmStatus` + ตัวนับที่จอรวมหลายไลน์เอาไปบวกได้
 *   · `late`  = ยังไม่ตรวจและเกินกรอบ 60 นาทีหลังเปิดใบแรก (ส้ม)
 *   · `wait`  = ยังไม่ตรวจแต่ยังอยู่ในกรอบ (ม่วง/รอ)
 *   · `notStarted` = ยังไม่ตรวจและไลน์ยังไม่เปิดใบผลิต (idle — ยังไม่ต้องตรวจ)
 *   · `ngN`   = จำนวนจุดที่ผลตรวจ = fail
 * 🔴 แดง (fail) ชนะทุกอย่าง · ส้มชนะรอ · "ยังไม่เริ่มผลิต" ≠ "ตรวจครบ" ห้ามให้สีเขียว
 * @returns { [line_name]: { status, total, checked, ngN, late, wait, notStarted, hasSession, missing, ng, firstOrderAt } }
 */
export function dailyAmLineStatus({ targets, jigs, resultByJig = {}, firstOrderByLine = {}, openSessionLines, shift, now } = {}) {
  const byLine = dailyAmTargetsByLine({ targets, jigs, shift })
  const out = {}
  for (const [line_name, tg] of Object.entries(byLine)) {
    const r = computeDailyPmStatus({ targets: tg, results: resultByJig, firstOrderAt: firstOrderByLine[line_name] ?? null, now })
    const missingN = r.missing.length
    const notStarted = r.firstOrderAt == null ? missingN : 0
    const late = r.firstOrderAt != null && r.windowPassed ? missingN : 0
    const wait = missingN - notStarted - late
    out[line_name] = {
      ...r,
      ngN: r.ng.length, late, wait, notStarted,
      // idle มีได้ 2 แบบ ต้องแยกให้ผู้ใช้เห็น ไม่งั้น "ยังไม่เริ่มผลิต" ตอนกะเดินอยู่ = จอโกหก
      hasSession: openSessionLines ? openSessionLines.has(line_name) : null,
    }
  }
  return out
}

