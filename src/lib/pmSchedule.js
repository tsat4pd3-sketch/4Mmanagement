const FREQ_DAYS = { daily: 1, weekly: 7, monthly: 30, quarterly: 90 }

export const FREQ_LABEL = {
  daily:     'รายวัน',
  weekly:    'รายสัปดาห์',
  monthly:   'รายเดือน',
  quarterly: 'รายไตรมาส',
  periodic:  'ตามรอบ',
}

// ป้ายชื่อทีมช่าง 4 ส่วน — ให้ตรงกับชื่อทีมฝั่ง MtnRepair (MTN/JIG MTN/DIE MTN/PRODUCTION)
// เพื่อไม่ให้ชื่อทีมปนกันระหว่างหน้า PM กับหน้าแจ้งซ่อม (คำสั่ง user 2026-07-22)
// key = checklists.department (คงเดิม) · เปลี่ยนเฉพาะข้อความแสดงผล
export const DEPT_LABEL = {
  // ฝ่ายผลิตตรวจเอง = AM (Autonomous Maintenance) — คนละงานกับ PM ของช่าง (ดู src/utils/pmTeams.js teamKind)
  production:      'AM (ผลิตตรวจเอง)',
  maintenance:     'MTN (ซ่อมบำรุง)',
  jig_maintenance: 'JIG MTN',
  die_maintenance: 'DIE MTN',
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
  return statusForDays(daysUntilDue(nextDue), frequency)
}

/* กติกาสีของ "อีกกี่วันถึงกำหนด" — จุดเดียว ใช้ทั้ง dueStatus (Date) และ resolvePlanDue (สตริง)
   ห้ามเขียนหน้าต่าง due_soon ซ้ำที่อื่น (แยกออกมา 2026-09-23 ตอนทำจอ 3 ระดับ PM) */
export function statusForDays(diffDays, frequency) {
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
  deferred:  { label: 'เลื่อนแผน (ตกลงแล้ว)', color: '#4a90e0', order: 1.5 },
  never:     { label: 'ยังไม่เคยตรวจ',  color: '#9b8de8', order: 2 },
  ok:        { label: 'ตามกำหนด',       color: '#3dd65c', order: 3 },
  periodic:  { label: 'ไม่มีรอบตายตัว', color: '#527855', order: 4 },
}

// เลื่อนแผน PM แบบตกลงกันแล้ว (คิวผลิตแน่น ฯลฯ) — active เมื่อ deferred_to ตั้งไว้
// และ "ยังไม่ถูกทำหลังเลื่อน" (last_done ไม่ใหม่กว่า deferred_at) · พอทำ PM รอบใหม่
// last_done จะใหม่กว่า deferred_at เอง = การเลื่อนถือว่าถูกใช้ไปแล้ว ไม่ค้าง
export function deferActive(plan) {
  if (!plan?.deferred_to) return false
  if (plan.last_done_at && plan.deferred_at && new Date(plan.last_done_at) >= new Date(plan.deferred_at)) return false
  return true
}

// สถานะ PM โดยคำนึงถึงการเลื่อนแผน · deferTo = Date ของวันเลื่อน (หรือ null)
// เลื่อนแล้ว & ยังไม่ถึงวันเลื่อน → 'deferred' (ฟ้า) · เลยวันเลื่อน → 'overdue' (นับจากวันเลื่อน)
export function dueStatusDefer(nextDue, frequency, deferTo) {
  if (deferTo) {
    const base = dueStatus(deferTo, frequency)
    return base === 'overdue' ? 'overdue' : 'deferred'
  }
  return dueStatus(nextDue, frequency)
}

/* ═══ resolvePlanDue — วันครบกำหนด PM แบบ pure (สตริง YYYY-MM-DD · ไม่พึ่ง timezone เครื่อง) ═══
   กติกาเดียวกับ PMSchedule.fetchData ทุกข้อ (ห้ามให้ 2 จอตอบวันครบกำหนดไม่ตรงกัน):
     1) ทำล่าสุด = pm_plans.last_done_at ก่อน · ไม่มี = ผลตรวจล่าสุดที่ไม่ถูก reject
     2) ครบกำหนด = pm_plans.next_due_date (server materialize) ก่อน · ไม่มี = ทำล่าสุด + รอบตาม frequency
     3) เลื่อนแผนที่ตกลงแล้ว (deferActive) ⇒ ใช้วันเลื่อน + สถานะ 'deferred'
   รับ `todayStr` จากผู้เรียก (เทสตรึงวันได้ — กฎ "เทสระเบิดเวลา" ใน CLAUDE.md)
   @returns {{ lastYmd, dueYmd, daysTo, status, isDeferred, hasCycle }}
     hasCycle=false = แผนนี้ "ไม่มีรอบ" (periodic ไม่มีวันครบกำหนด) — จอ 3 ระดับนับเป็นช่องว่างของ Preventive */
export function ymdBangkok(v) {
  if (!v) return null
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
const ymdUtc = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const addYmd = (ymd, n) => new Date(ymdUtc(ymd) + n * 86400000).toISOString().slice(0, 10)   // UTC ล้วน ปลอดภัย (ไม่ใช่เวลาปัจจุบัน)
export const diffYmd = (from, to) => Math.round((ymdUtc(to) - ymdUtc(from)) / 86400000)

export function resolvePlanDue({ frequency, plan = null, lastInspectedAt = null, todayStr }) {
  const lastYmd = ymdBangkok(plan?.last_done_at ?? lastInspectedAt ?? null)
  const freqDays = FREQ_DAYS[frequency]
  const origDue = plan?.next_due_date
    ? String(plan.next_due_date).slice(0, 10)
    : (freqDays && lastYmd ? addYmd(lastYmd, freqDays) : null)
  const isDeferred = deferActive(plan)
  const deferTo = isDeferred && plan?.deferred_to ? String(plan.deferred_to).slice(0, 10) : null
  const dueYmd = deferTo || origDue
  const daysTo = dueYmd && todayStr ? diffYmd(todayStr, dueYmd) : null
  let status
  if (!dueYmd) status = frequency === 'periodic' ? 'periodic' : 'never'
  else {
    status = statusForDays(daysTo, frequency)
    if (deferTo) status = status === 'overdue' ? 'overdue' : 'deferred'
  }
  const hasCycle = !!(freqDays || plan?.next_due_date || Number(plan?.interval_days) > 0)
  return { lastYmd, dueYmd, daysTo, status, isDeferred, hasCycle }
}
