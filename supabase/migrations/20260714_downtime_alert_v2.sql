-- Downtime alert overhaul (2026-07-14) — ลดสัญญาณรบกวน + เพิ่ม "เรียกช่าง MTN"
-- Project: DR (eyhclzkifitbhbljgoav) — app คุยผ่าน supabaseDR (anon เสมอ) → RLS ต้อง anon-open
-- กติกาใหม่:
--   • บันทึก downtime แบบปิดแล้ว (ลงย้อนหลัง) → ไม่แจ้ง Telegram ทันที (สรุปตอนปิดกะแทน)
--   • บันทึกแบบเปิดค้าง → ไม่แจ้งทันที · ถ้ายังเปิดค้างเกิน N นาที (config) → scanner แจ้ง + ดังหน้า Production
--   • ปุ่ม "เรียกช่าง MTN" → แจ้งทันที + ดังหน้า Maintenance

alter table public.downtime_logs
  add column if not exists open_alerted_at  timestamptz,  -- scanner แจ้ง "เปิดค้างเกิน N นาที" แล้ว (กันซ้ำ)
  add column if not exists open_ack_at       timestamptz,  -- production กด "รับทราบ" เสียงเปิดค้าง
  add column if not exists call_mtn           boolean not null default false,
  add column if not exists call_mtn_at        timestamptz,
  add column if not exists call_mtn_by        text,
  add column if not exists call_mtn_ack_at    timestamptz;  -- maintenance กด "รับทราบ" เสียงเรียกช่าง

-- config เกณฑ์เวลา (แถวเดียว) — ปรับได้จากหน้า ตั้งค่าการแจ้งเตือน
create table if not exists public.dt_alert_config (
  id                int primary key default 1,
  open_alert_min    int not null default 15,   -- เปิดค้างเกินกี่นาทีถึงแจ้ง
  updated_at        timestamptz not null default now(),
  constraint dt_alert_config_singleton check (id = 1)
);
insert into public.dt_alert_config (id) values (1) on conflict (id) do nothing;
alter table public.dt_alert_config enable row level security;
drop policy if exists dt_alert_config_all on public.dt_alert_config;
create policy dt_alert_config_all on public.dt_alert_config for all to anon, authenticated using (true) with check (true);
