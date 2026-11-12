-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 ใบถังเหลืองเดินแบบใบ MO — ขั้น 3 ผลิตซ่อม → ขั้น 4 QA ตรวจรับ   ·   project = DR "Product DB" (eyhclzkifitbhbljgoav)
--
-- ที่มา: คำสั่ง user 2026-11-10 "ให้ทำงานได้เหมือน MO · ทำขั้น 1-5 ก่อน · ซ่อมแล้ว QA ตรวจรับ"
--   ขั้นคำนวณจากข้อเท็จจริง (`ncStep()` ใน src/utils/qualityBin.js) — ไม่มีคอลัมน์ step
--   คอลัมน์ใหม่ = หลักฐานของขั้น 4 (ใครตรวจรับ/เมื่อไหร่) + เหตุผลตอนตีกลับ
-- additive ล้วน (nullable / default 0) · โค้ดเก่าไม่อ่าน = ไม่กระทบ
-- ย้อน: alter table quality_bin_records drop column if exists repair_accepted_by, drop column if exists repair_accepted_at,
--         drop column if exists repair_reject_note, drop column if exists repair_reject_count;
-- ═══════════════════════════════════════════════════════════════════════════
alter table quality_bin_records add column if not exists repair_accepted_by  text;
alter table quality_bin_records add column if not exists repair_accepted_at  timestamptz;
alter table quality_bin_records add column if not exists repair_reject_note  text;
alter table quality_bin_records add column if not exists repair_reject_count integer not null default 0;

-- ตรวจหลังรัน:
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name = 'quality_bin_records' and column_name like 'repair_%' order by 1;
