-- PM Inspection Setup gaps — TASK 1+2+3 จาก handoff (HANDOFF_PM_INSPECTION_SETUP_GAPS)
-- Target project: DR/Product (eyhclzkifitbhbljgoav) — client `supabaseDR` (role anon เสมอ)
--
-- ⚠️ ตารางจริงบน DB คือ jigs / checklists / jig_checkpoints / inspections /
--    inspection_results (ไม่ใช่ pm_* ตาม migration 20260701 ที่ล้าสมัย)
--    verify กับ live schema แล้วก่อน apply (2026-07-09)
--
-- เพิ่มคอลัมน์บน jig_checkpoints (ตารางเดิมมี RLS anon-friendly อยู่แล้ว
-- การเพิ่มคอลัมน์ไม่แตะ policy ใดๆ):
--   group_name / group_order  → TASK 1 จัดกลุ่มหัวข้อ (Item 1 "Locate Pin" → LP1..)
--   description               → TASK 2 เกณฑ์ตัดสิน (Standard) หลายบรรทัดของ attribute
--   image_path                → TASK 3 รูปอ้างอิงต่อ checkpoint (bucket jig-images)

alter table public.jig_checkpoints add column if not exists group_name  text;
alter table public.jig_checkpoints add column if not exists group_order int;
alter table public.jig_checkpoints add column if not exists description text;
alter table public.jig_checkpoints add column if not exists image_path  text;
