-- ตั้งค่าจริงหลังเปิดช่อง duration_min_holiday (2026-10-27 · คำสั่ง user) — รันไปแล้วผ่าน MCP
-- บันทึกไว้ที่นี่เพื่อให้ session อื่นเห็นว่า "ของจริงในฐานถูกตั้งเป็นอะไร"

-- ① วันที่ไม่ใช่วันทำงาน พักเที่ยง/พักดึก 50 → 60 นาที
update public.break_policies
set duration_min_holiday = 60, updated_at = now()
where duration_min = 50 and is_active;

-- ② ป้ายกระบวนการของแม่พิมพ์/จิ๊ก บนไลน์ที่เครื่องจักรจริงเป็น metal_forming
--    (HDF1 · HDF2 · LASER-345 · LASER-789 — 73 แถว)
--    🔴 สำรองค่าเดิมไว้ที่ archive.machines_process_type_20261027 ก่อนแก้ (ย้อนกลับได้)
--    🔴 **ไม่แตะไลน์เชื่อม** (LASER EXPORT · LASER E50 · Line 60) — Line 60 มีจิ๊ก metal_forming
--       ที่หน้างานใช้จริง (ลง downtime ประเภทนั้นไปแล้ว 10 ใบ) แตะแล้วตัวเลือกจะหาย
update public.machines
set process_type = 'metal_forming', updated_at = now()
where line_name in ('HDF1','HDF2','LASER-345','LASER-789')
  and equipment_kind <> 'machine'
  and process_type is distinct from 'metal_forming';

-- ย้อนกลับ ②:
--   update public.machines m set process_type = a.process_type
--   from archive.machines_process_type_20261027 a where a.id = m.id;
