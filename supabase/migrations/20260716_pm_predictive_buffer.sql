-- PM Predictive + Planner Sync + Buffer (2026-07-16)
-- DR project (eyhclzkifitbhbljgoav) — เพิ่ม config ต่อแผน PM สำหรับคำนวณ buffer + เตือนล่วงหน้า
--   (usage_metric/usage_threshold/usage_source_line มีอยู่แล้วสำหรับ trigger ตาม shot)
alter table public.pm_plans add column if not exists pm_duration_hours numeric;   -- เครื่องหยุดกี่ชม.ตอนทำ PM
alter table public.pm_plans add column if not exists lead_time_days integer default 10; -- แจ้งล่วงหน้ากี่วัน
alter table public.pm_plans add column if not exists buffer_margin_pct numeric default 15; -- %เผื่อ buffer
