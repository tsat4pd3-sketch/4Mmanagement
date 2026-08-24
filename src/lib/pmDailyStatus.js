// System 1 — Production Daily Preventive Maintenance status logic (pure).
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
