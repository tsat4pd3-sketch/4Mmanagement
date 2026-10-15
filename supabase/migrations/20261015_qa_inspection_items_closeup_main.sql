-- MAIN project (ewhdfqwfwofivojtsizn · ชื่อในจอ "MAIN")
-- 2026-10-15 · ตั้งค่าจุดตรวจ QA ใช้หลักเดียวกับ PM (docs/modules/inspection-point-setup.md)
-- รูปโคลสอัพรายจุด (📷 รูปจุด) — PM มีมาตั้งแต่ 2026-07-09 (jig_checkpoints.image_path) · QA ยังไม่มี
-- เก็บเป็น storage path ใน bucket `qa-drawings` (parts/<part_id>/cp-*.jpg) · null = ไม่มีรูป
-- additive · nullable · RLS เดิมของตารางครอบคอลัมน์ใหม่อยู่แล้ว (เขียน = qa:manage)
alter table public.qa_inspection_items add column if not exists image_path text;

comment on column public.qa_inspection_items.image_path is
  'รูปโคลสอัพของจุดตรวจ (storage path ใน bucket qa-drawings) — คนตรวจแตะหมุด 🔍 แล้วซูมดู · null = ไม่มี';

-- rollback: alter table public.qa_inspection_items drop column if exists image_path;
