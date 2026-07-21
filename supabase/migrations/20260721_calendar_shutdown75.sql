-- ── Main project ──
-- เพิ่ม day_type 'shutdown75' ในปฏิทินบริษัท — วันหยุดชั่วคราวตามมาตรา 75 (ลูกค้าลด order)
-- ความหมาย: ประกาศหยุด = พนักงานได้ค่าจ้าง 75% · ถูกเรียกมาทำงาน = ค่าแรงปกติ (ไม่ใช่ OT วันหยุด)
-- ระบบเก็บไว้เป็นข้อมูลอ้างอิง ยังไม่คำนวณเงิน (2026-07-21)
-- ผลต่อระบบ: นับเป็น "วันหยุดโรงงาน" ใน working-day calc (kanban/LPA/แผนงาน) เหมือน ot15/ot2
--            แต่ไม่เข้า flow จอง OT วันหยุด (Checkin/Report ใช้ isOtHolidayType = ot15/ot2 เท่านั้น)

-- drop check constraint เดิมของ day_type (ถ้ามี — ชื่ออาจต่างกันตามตอนสร้างตาราง) แล้วสร้างใหม่รวม shutdown75
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'company_calendar'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%day_type%'
  loop
    execute format('alter table company_calendar drop constraint %I', c.conname);
  end loop;
end $$;

alter table company_calendar add constraint company_calendar_day_type_check
  check (day_type in ('working', 'ot15', 'ot2', 'shutdown75'));
