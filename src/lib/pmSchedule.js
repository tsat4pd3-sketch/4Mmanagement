const FREQ_DAYS = { daily: 1, weekly: 7, monthly: 30, quarterly: 90 }

export const FREQ_LABEL = {
  daily:     'รายวัน',
  weekly:    'รายสัปดาห์',
  monthly:   'รายเดือน',
  quarterly: 'รายไตรมาส',
  periodic:  'ตามรอบ',
}

export const DEPT_LABEL = {
  production:      'ฝ่ายผลิต',
  maintenance:     'ซ่อมบำรุง',
  jig_maintenance: 'JIG Maintenance',
  die_maintenance: 'Die Maintenance',
  qa:              'QA',
}

// DB constraint jigs_equipment_type_check allows only these three — keep in sync.
export const EQUIP_TYPE_LABEL = {
  jig:     'JIG',
  die:     'Die',
  machine: 'Machine',
}

export function computeNextDue(lastInspectedAt, frequency) {
  const days = FREQ_DAYS[frequency]
  if (!days || !lastInspectedAt) return null
  const next = new Date(lastInspectedAt)
  next.setDate(next.getDate() + days)
  return next
}

// Whole-day difference between two dates, ignoring time-of-day. Positive = the
// target is in the future. Both sides are floored to local midnight (local =
// Asia/Bangkok for this deployment) so an inspection logged at 15:00 doesn't
// make the schedule flip status at 15:00 on the due day.
function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function daysUntilDue(nextDue) {
  if (!nextDue) return null
  return Math.round((startOfDay(nextDue).getTime() - startOfDay(new Date()).getTime()) / 86400000)
}

export function dueStatus(nextDue, frequency) {
  if (!nextDue) return frequency === 'periodic' ? 'periodic' : 'never'
  const diffDays = daysUntilDue(nextDue)
  if (diffDays < 0) return 'overdue'
  // "Due soon" window scales with the cycle: a daily check only warns on the
  // due day itself, while weekly/monthly warn up to 3 days ahead. Without this
  // a daily checklist could never reach the calm "ok" state.
  const cycle = FREQ_DAYS[frequency] ?? 0
  const soonWindow = Math.min(3, Math.max(0, cycle - 1))
  if (diffDays <= soonWindow) return 'due_soon'
  return 'ok'
}

export const STATUS_META = {
  overdue:   { label: 'เกินกำหนด',      color: '#e05c4a', order: 0 },
  due_soon:  { label: 'ใกล้ครบกำหนด',   color: '#f59a3f', order: 1 },
  never:     { label: 'ยังไม่เคยตรวจ',  color: '#9b8de8', order: 2 },
  ok:        { label: 'ตามกำหนด',       color: '#3dd65c', order: 3 },
  periodic:  { label: 'ไม่มีรอบตายตัว', color: '#527855', order: 4 },
}
