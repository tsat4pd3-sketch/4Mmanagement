// PM predictive — คำนวณ "วันที่จะถึงรอบ PM ล่วงหน้า" + buffer ที่ต้องผลิตเผื่อ (2026-07-16)
//   ตามรอบเวลา (plan_type time) → ใช้ next_due_date ตรงๆ
//   ตาม shot/ยอดผลิต (usage) → วันถึงรอบ = วันนี้ + (เกณฑ์ − shot สะสม) ÷ อัตราผลิต/วัน (จาก forecast ลูกค้า)
//   buffer = ยอด demand ช่วงเครื่องหยุด PM × (1 + %เผื่อ)   (ดู CLAUDE.md ส่วน PM Predictive)
// pure functions — ไม่แตะ DB (ตัวเรียกเตรียมข้อมูลมาให้)

// วันที่จะถึงรอบจาก usage: remaining shot ÷ อัตรา/วัน → บวกจากวันนี้
export function projectUsageDate(remaining, dailyRate, todayStr) {
  if (!dailyRate || dailyRate <= 0 || remaining == null) return null
  const days = Math.max(0, Math.ceil(remaining / dailyRate))
  const d = new Date(todayStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d
}

// buffer ที่ต้องผลิตเผื่อ = อัตรา/วัน × (ชม.หยุด ÷ ชม.ทำงาน/วัน) × (1 + margin%)
export function computeBuffer(dailyRate, pmDurationHours, marginPct = 15, hoursPerDay = 16) {
  if (!dailyRate || !pmDurationHours) return 0
  const lostProdDays = pmDurationHours / hoursPerDay
  return Math.ceil(dailyRate * lostProdDays * (1 + (Number(marginPct) || 0) / 100))
}

// จำนวนวันจากวันนี้ถึงวันเป้า (อาจติดลบ = เลยแล้ว)
export function daysTo(dateObj, todayStr) {
  if (!dateObj) return null
  const t = new Date(todayStr + 'T00:00:00')
  return Math.round((dateObj - t) / 86400000)
}

// รวมผลลัพธ์ต่อแผน 1 อัน
//   plan: { plan_type, usage_threshold, interval_days, next_due_date, pm_duration_hours, lead_time_days, buffer_margin_pct }
//   ctx:  { accumUsage, dailyRate, todayStr }
export function computePlanForecast(plan, ctx) {
  const { accumUsage = 0, dailyRate = 0, todayStr } = ctx
  const isUsage = plan.plan_type === 'usage' || plan.usage_metric || plan.usage_threshold != null
  let projected = null, remaining = null
  if (isUsage && plan.usage_threshold != null) {
    remaining = Number(plan.usage_threshold) - Number(accumUsage || 0)
    projected = projectUsageDate(remaining, dailyRate, todayStr)
  } else if (plan.next_due_date) {
    projected = new Date(plan.next_due_date + 'T00:00:00')
  }
  const dTo = daysTo(projected, todayStr)
  const lead = plan.lead_time_days ?? 10
  const inWindow = dTo != null && dTo <= lead
  const overdue = dTo != null && dTo < 0
  const buffer = computeBuffer(dailyRate, plan.pm_duration_hours, plan.buffer_margin_pct)
  return { isUsage, remaining, projected, daysTo: dTo, lead, inWindow, overdue, buffer, dailyRate, accumUsage }
}
