-- จองรถ OT วันหยุด: เพิ่มคอลัมน์รูปแบบช่วงเวลา OT (Main project ewhdfqwfwofivojtsizn)
-- วันทำงานปกติ OT = ช่วงต่อท้ายกะ (เช้า 17:30–20:00 / ดึก 20:00–22:30) → ot_period = NULL
-- วันหยุด (company_calendar.day_type != 'working') มี 4 รูปแบบ:
--   holiday_day_8h    = เช้า 8 ชม.  08:00–17:00
--   holiday_day_10h   = เช้า 10 ชม. 08:00–20:00
--   holiday_night_10h = ดึก 10 ชม.  20:00–08:00
--   holiday_night_8h  = ดึก 8 ชม.   22:00–08:00
-- Backward compatible: nullable ไม่มี default — จองเก่า/โค้ดเก่า insert ได้เหมือนเดิม
-- Rollback: revert โค้ดก่อน แล้วค่อย alter table ot_night_bookings drop column ot_period;

alter table ot_night_bookings
  add column if not exists ot_period text
  check (ot_period is null or ot_period in
    ('holiday_day_8h', 'holiday_day_10h', 'holiday_night_10h', 'holiday_night_8h'));

comment on column ot_night_bookings.ot_period is
  'รูปแบบช่วงเวลา OT วันหยุด (null = OT ปกติวันทำงาน) — ดู src/utils/otPeriods.js';
