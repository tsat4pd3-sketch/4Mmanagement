-- ═══════════════════════════════════════════════════════════════════
-- ถอยใบที่สแกนปิดไปแล้ว (revert confirmed → open) — DR project
-- ปัญหา (user 2026-07-15): หัวหน้ากลุ่มสแกนปิดออเดอร์เกินยอดที่ผลิตได้จริง
-- แล้วไม่มีทางย้อน — เพิ่มปุ่ม "↩️ ถอยใบ" ใน DailyReport + เก็บร่องรอยใครถอยกี่ครั้ง
-- (คอลัมน์ additive ทั้งหมด — ใบเดิม/flow เดิมไม่กระทบ · rollback: แค่ revert โค้ด คอลัมน์ทิ้งไว้ได้)
-- ═══════════════════════════════════════════════════════════════════

alter table prod_orders add column if not exists reopened_by text;
alter table prod_orders add column if not exists reopened_at timestamptz;
alter table prod_orders add column if not exists reopen_count int not null default 0;

comment on column prod_orders.reopen_count is
  'จำนวนครั้งที่ใบนี้ถูกถอยจาก confirmed กลับเป็น open (สแกนปิดเกิน/ปิดผิดใบ) — audit ให้หัวหน้าแผนกตรวจได้';
