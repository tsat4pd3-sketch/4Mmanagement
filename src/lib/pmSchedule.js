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

export const EQUIP_TYPE_LABEL = {
  jig:     'JIG',
  die:     'Die',
  machine: 'Machine',
  fixture: 'Fixture',
  tool:    'Tool',
}

export function computeNextDue(lastInspectedAt, frequency) {
  const days = FREQ_DAYS[frequency]
  if (!days || !lastInspectedAt) return null
  const next = new Date(lastInspectedAt)
  next.setDate(next.getDate() + days)
  return next
}

export function dueStatus(nextDue, frequency) {
  if (!nextDue) return frequency === 'periodic' ? 'periodic' : 'never'
  const diffDays = (nextDue.getTime() - Date.now()) / 86400000
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 3) return 'due_soon'
  return 'ok'
}

export const STATUS_META = {
  overdue:   { label: 'เกินกำหนด',      color: '#e05c4a', order: 0 },
  due_soon:  { label: 'ใกล้ครบกำหนด',   color: '#f59a3f', order: 1 },
  never:     { label: 'ยังไม่เคยตรวจ',  color: '#9b8de8', order: 2 },
  ok:        { label: 'ตามกำหนด',       color: '#3dd65c', order: 3 },
  periodic:  { label: 'ไม่มีรอบตายตัว', color: '#527855', order: 4 },
}
