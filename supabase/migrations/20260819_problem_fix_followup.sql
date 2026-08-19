-- วิธีแก้ไข + ผลการตรวจติดตาม ต่อรายการปัญหา (downtime / ของเสีย)
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — additive ล้วน
--
-- ที่มา: feedback หน้างาน 2026-08-19 (หัวหน้ากลุ่ม Assy2)
--   "ถ้าเกิน 30 นาที ให้มีไอคอนขึ้นมาให้หัวหน้ากลุ่มลงวิธีแก้ไข และผลตรวจติดตาม"
--   → เดิม "ใบรายงานปัญหาการผลิต" ต้องปริ้นออกมาเขียน 2 ช่องนี้ด้วยมือทุกใบ
--     ตอนนี้ลงในระบบตรงรายการนั้นได้เลย แล้วใบพิมพ์เติมให้เอง
--
-- ⚠️ ไม่มีตารางใหม่โดยตั้งใจ — "วิธีแก้ไขปัญหานี้" เป็นคุณสมบัติของ "ปัญหา" ตัวนั้น
--    แยกตารางจะกลายเป็นบันทึกลอยที่ต้อง join กลับ + ต้องตามลบเองตอนลบรายการ
--    (คอลัมน์ในตารางเดิม = ลบรายการแล้วหายไปพร้อมกันเสมอ)
--
-- ⚠️ ผู้แก้ไข/ผู้ตรวจติดตาม เก็บเป็น "ข้อความ" ไม่ใช่ FK — snapshot pattern เดียวกับ
--    downtime_logs.reported_by_name ที่มีอยู่เดิม (ใบเก่าต้องอ่านออกแม้คนลาออก)

alter table public.downtime_logs
  add column if not exists fix_action      text,          -- วิธีการแก้ไข
  add column if not exists fix_by          text,          -- ผู้แก้ไข
  add column if not exists fix_at          timestamptz,
  add column if not exists followup_result text,          -- ผลการตรวจติดตามการแก้ไข
  add column if not exists followup_by     text,
  add column if not exists followup_at     timestamptz;

alter table public.defect_logs
  add column if not exists fix_action      text,
  add column if not exists fix_by          text,
  add column if not exists fix_at          timestamptz,
  add column if not exists followup_result text,
  add column if not exists followup_by     text,
  add column if not exists followup_at     timestamptz;

-- ค้นหา "รายการที่ยังไม่ลงวิธีแก้ไข" ได้เร็ว (คิวงานค้างของหัวหน้ากลุ่ม)
create index if not exists downtime_logs_no_fix_idx on public.downtime_logs (session_id)
  where fix_action is null;
create index if not exists defect_logs_no_fix_idx on public.defect_logs (session_id)
  where fix_action is null;

-- Rollback:
--   alter table public.downtime_logs
--     drop column fix_action, drop column fix_by, drop column fix_at,
--     drop column followup_result, drop column followup_by, drop column followup_at;
--   alter table public.defect_logs  ... (เหมือนกัน)
