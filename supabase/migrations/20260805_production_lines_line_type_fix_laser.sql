-- แก้ backfill line_type ที่ลำดับกฎผิด — 2026-08-05
-- ★ Apply on Main project (ewhdfqwfwofivojtsizn)
--
-- migration 20260722_production_lines_line_type.sql ตีกฎ "ไลน์แม่ชื่อ HYDROFORM" ก่อนกฎ "ชื่อไลน์มี LASER"
-- → ไลน์เลเซอร์ที่อยู่ใต้กลุ่ม HYDROFORM (LASER E50, LASER EXPORT, LASER-345, LASER-789)
--   ถูก backfill เป็น 'hydroform' ทั้งที่เป็นเครื่องเลเซอร์
-- กฎที่ถูก: ชื่อไลน์ตัวเองชนะไลน์แม่เสมอ (ไลน์แม่เป็นแค่การจัดกลุ่มบริหาร ไม่ใช่ประเภทเครื่อง)

update production_lines set line_type = 'laser'
 where upper(name) like '%LASER%' and line_type is distinct from 'laser';

-- Rollback: ไม่ต้อง (ค่าเดิมผิดอยู่แล้ว) — จะย้อนให้เหมือนเดิมเป๊ะต้อง set กลับเป็น 'hydroform' รายไลน์เอง
