/* ══ 💸 otCost — "ค่า OT" สำหรับบอร์ด Obeya แกน C (2026-11-26 · คำสั่ง user) ═══════════════════════════════
   user: "ให้คำนวณชั่วโมง OT ที่เปิด คิดกับค่าแรงมาตรฐาน คูณ 1.5 / 2 ตามปฏิทิน … ไม่ได้ต้องการความถูกต้อง 100%
          แต่ให้พนักงานหน้างานเห็นภาพและตระหนักเรื่องต้นทุน"
   · ชั่วโมง OT ต่อคน-วัน มาจากการเช็คชื่อ (`daily_production_logs.has_ot/has_extended_ot/shift`) — กติกาเดียวกับใบ OT
     ที่ /checkin ส่งออก (เดิมเขียนเลข 2/5/2 ไว้ในหน้า ⇒ ย้ายมาเป็นของกลางที่นี่ **ห้ามเขียนซ้ำในหน้า**)
   · ค่าแรง = ตัวเลขเดียวทั้งโรงงาน (`obeya_cost_settings.ot_wage_per_hour` · default 50) — **ไม่ใช่** `cost_center_rates.dl_rate`
     (ตัวนั้นเป็นของ cost saving /improvements · ถ้าใช้ 2 ตัวจะมี "ค่าแรง 2 ชุด")
   · ตัวคูณจาก **ปฏิทินบริษัทเท่านั้น** (วันทำงาน 1.5 · ot15 1.5 · ot2 2) — ห้ามเดาจากวันในสัปดาห์
   · วันหยุด (ot15/ot2) ชั่วโมง = ช่วง OT ที่จอง (`ot_night_bookings.ot_period` 8/10 ชม.) · ไม่มีใบจอง = 8 ชม. + ติดป้ายประมาณ
   · ไม่รู้ค่าแรง = `baht: null` (จอเขียนว่าคิดไม่ได้ · ห้าม 0) · pure · ไม่แตะเวลาปัจจุบัน · เทส `__tests__/otCost.test.mjs` */

export const OT_WAGE_DEFAULT = 50;                 // บาท/ชม. — ค่าเริ่มต้นตามที่ user เคาะ 26/11 (ของจริงอ่านจาก obeya_cost_settings)
export const OT_HOURS = { day: 2, dayExtended: 5, night: 2, holidayDefault: 8 };
export const OT_MULTIPLIER = { working: 1.5, ot15: 1.5, ot2: 2 };

export const isOtHolidayDayType = (t) => t === 'ot15' || t === 'ot2';
export const otMultiplierOf = (dayType) => OT_MULTIPLIER[dayType] ?? OT_MULTIPLIER.working;

/** ชั่วโมง OT ของแถวเช็คชื่อ 1 แถว (คน-วัน) — 0 เมื่อไม่ได้ทำ OT
 *  @param log   { has_ot, has_extended_ot, shift }
 *  @param opt   { holiday: วันหยุดตามปฏิทิน, bookingHours: ชม.จากใบจอง (วันหยุด) } */
export function otHoursOfLog(log, { holiday = false, bookingHours = null } = {}) {
  if (!log || !(log.has_ot || log.has_extended_ot)) return 0;
  if (holiday) return Number(bookingHours) > 0 ? Number(bookingHours) : OT_HOURS.holidayDefault;
  if (log.shift === 'night') return OT_HOURS.night;
  return log.has_extended_ot ? OT_HOURS.dayExtended : OT_HOURS.day;
}

/**
 * ค่า OT ของช่วง (โหมดเดือน/สัปดาห์) จากแถวเช็คชื่อที่กรองขอบเขตแล้ว
 * @param {object} p
 * @param {Array}  p.logs           แถว daily_production_logs { work_date, employee_id, shift, has_ot, has_extended_ot }
 * @param {number} p.rate           ค่าแรง บาท/ชม. (null/0 = ไม่รู้ ⇒ baht null)
 * @param {(d:string)=>string|null} [p.dayTypeOf]      'YYYY-MM-DD' → day_type จากปฏิทิน (null = ไม่ได้มาร์ค = วันทำงาน)
 * @param {(emp:string,d:string)=>number|null} [p.bookingHoursOf]  ชม.จากใบจองวันหยุดของคนนั้นวันนั้น
 * @returns {{ baht:number|null, hours:number, rows:number, holidayRows:number, holidayGuess:number, byDate:Object, unknownRate:boolean }}
 */
export function otCostOf({ logs = [], rate, dayTypeOf = () => null, bookingHoursOf = () => null } = {}) {
  const r = Number(rate);
  const out = { baht: null, hours: 0, rows: 0, holidayRows: 0, holidayGuess: 0, byDate: {}, unknownRate: !(r > 0) };
  let baht = 0;
  for (const l of logs || []) {
    if (!l || !(l.has_ot || l.has_extended_ot)) continue;
    const d = String(l.work_date || '').slice(0, 10);
    const dt = dayTypeOf(d) || 'working';
    const holiday = isOtHolidayDayType(dt);
    const bk = holiday ? bookingHoursOf(l.employee_id, d) : null;
    const hours = otHoursOfLog(l, { holiday, bookingHours: bk });
    if (holiday) { out.holidayRows++; if (!(Number(bk) > 0)) out.holidayGuess++; }
    const mult = otMultiplierOf(dt);
    const v = out.unknownRate ? 0 : hours * r * mult;
    out.rows++; out.hours += hours; baht += v;
    const b = out.byDate[d] || (out.byDate[d] = { hours: 0, baht: 0, n: 0, mult });
    b.hours += hours; b.baht += v; b.n++;
  }
  out.baht = out.unknownRate ? null : Math.round(baht);
  return out;
}

/** โหมดปี — จากแถว RPC `obeya_attendance_rollup` { m, ot_day, ot_ext, ot_night, ot_hol15, ot_hol2 } (นับคน-วัน · ชั่วโมงวันหยุดถือ 8 = ประมาณ)
 *  คืน rows { m, ot } สำหรับ axisCostYear · `approx` = มีวันหยุดที่เดาชั่วโมง · แถว RPC รุ่นเก่าไม่มีฟิลด์ใหม่ = ot ของเดือนนั้น null (จอเขียนว่ายังไม่รองรับ) */
export function otCostYearRows(rows = [], rate) {
  const r = Number(rate);
  const byM = {}; let approx = false; let legacy = false;
  for (const x of rows || []) {
    if (!x?.m) continue;
    if (x.ot_day == null && x.ot_ext == null && x.ot_night == null) { if (Number(x.ot) > 0) legacy = true; continue; }
    const hol15 = Number(x.ot_hol15) || 0, hol2 = Number(x.ot_hol2) || 0;
    if (hol15 || hol2) approx = true;
    const hours15 = (Number(x.ot_day) || 0) * OT_HOURS.day + (Number(x.ot_ext) || 0) * OT_HOURS.dayExtended + (Number(x.ot_night) || 0) * OT_HOURS.night
      + hol15 * OT_HOURS.holidayDefault;
    const hours2 = hol2 * OT_HOURS.holidayDefault;
    const v = r > 0 ? hours15 * r * OT_MULTIPLIER.ot15 + hours2 * r * OT_MULTIPLIER.ot2 : 0;
    byM[x.m] = (byM[x.m] || 0) + v;
  }
  return { rows: Object.entries(byM).map(([m, ot]) => ({ m, dt: 0, ng: 0, ot: Math.round(ot) })), approx, legacy, unknownRate: !(r > 0) };
}

/** ข้อความสูตรให้คนหน้างานอ่าน — "2.5 ชม. × 50 บ. × 1.5" */
export const otRateText = (rate) => (Number(rate) > 0 ? `${Number(rate).toLocaleString('en-US')} บ./ชม.` : 'ยังไม่ตั้งค่าแรง');
