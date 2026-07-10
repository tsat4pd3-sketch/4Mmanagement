/**
 * รูปแบบช่วงเวลา OT วันหยุด (holiday OT patterns) — source of truth เดียว
 * ใช้ร่วมกันระหว่างหน้าเช็คชื่อ (จองรถ OT) และหน้า Report แท็บจองรถ OT
 *
 * วันทำงานปกติ: OT คือช่วงต่อท้ายกะ (เช้า 17:30–20:00 / ดึก 20:00–22:30) → ot_period = null
 * วันหยุด (company_calendar day_type != 'working'): มาทำ OT ทั้งกะ เลือกรูปแบบได้ 4 แบบ
 * เก็บใน ot_night_bookings.ot_period (null = OT ปกติวันทำงาน / จองเก่าก่อนมีฟีเจอร์นี้)
 */

export const HOLIDAY_OT_PERIODS = [
  { value: 'holiday_day_8h',    shift: 'day',   hours: 8,  time: '08:00–17:00' },
  { value: 'holiday_day_10h',   shift: 'day',   hours: 10, time: '08:00–20:00' },
  { value: 'holiday_night_10h', shift: 'night', hours: 10, time: '20:00–08:00' },
  { value: 'holiday_night_8h',  shift: 'night', hours: 8,  time: '22:00–08:00' },
];

export const otPeriodMeta = (value) =>
  HOLIDAY_OT_PERIODS.find(p => p.value === value) || null;

export const holidayPeriodsForShift = (shift) =>
  HOLIDAY_OT_PERIODS.filter(p => p.shift === shift);

/** ค่า default ตอนติ๊กจองวันหยุด — 8 ชม. ของกะนั้น (เปลี่ยนได้จาก select) */
export const defaultHolidayPeriod = (shift) =>
  shift === 'day' ? 'holiday_day_8h' : 'holiday_night_8h';

export const otPeriodLabel = (value) => {
  const m = otPeriodMeta(value);
  return m ? `${m.time} (${m.hours} ชม.)` : '';
};

/** ช่วงเวลา OT มาตรฐานวันทำงานปกติ ตามกะ */
export const WEEKDAY_OT_TIME = { day: '17:30–20:00', night: '20:00–22:30' };
