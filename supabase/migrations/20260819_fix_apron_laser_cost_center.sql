-- แก้ cost center ของไลน์ที่ตั้งผิด/ยังไม่ตั้ง (user ยืนยัน 2026-08-19)
--
-- 1) Line 60 / Line 61 ตั้งเป็น 2140662101 = "HYDROFRORM 1" ซึ่งเป็นคนละกลุ่มกัน (น่าจะพิมพ์ผิด)
--    2 ไลน์นี้อยู่ใต้ LINE APRON ASSY → ต้องเป็น 2140662201 (APRON ASSY)
--    ผลก่อนแก้: cost saving ของ 60/61 คิดด้วย 4,653.01 บาท/ชม. แทนที่จะเป็น 2,220.78 = สูงเกินจริง 2.1 เท่า
--
-- 2) LASER-345 / LASER-789 ยังไม่มี cost center — บัญชีจัดอยู่ใน cost center เดียวกับ HDF1/HDF2
--    (แยกเป็นคนละไลน์ในระบบเพราะ "หน้างานอยากแยก product เพื่อมอนิเตอร์" ไม่ใช่แยกทางบัญชี)
--    → 1 cost center มีได้หลายไลน์ (many-to-one) ปกติ ไม่ผิดกฎอะไร
--
-- ⚠️ ไม่แตะไลน์แม่ (LINE APRON ASSY / HYDROFORM) ที่สงสัยว่าสลับรหัสกับผังองค์กร — รอบัญชียืนยันก่อน
-- ⚠️ improvements = 0 แถว (ตรวจ 2026-08-19) → ไม่มีตัวเลข saving เดิมที่จะเปลี่ยนย้อนหลัง
--
-- rollback:
--   update production_lines set cost_center = '2140662101' where name in ('Line 60','Line 61');
--   update production_lines set cost_center = null where name in ('LASER-345','LASER-789');

update public.production_lines
set cost_center = '2140662201'
where name in ('Line 60', 'Line 61') and cost_center = '2140662101';

update public.production_lines set cost_center = '2140662101'
where name = 'LASER-345' and cost_center is null;

update public.production_lines set cost_center = '2140662102'
where name = 'LASER-789' and cost_center is null;
