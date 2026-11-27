-- ⚡ Project: DR ("Product DB" · eyhclzkifitbhbljgoav) — 2026-11-25 คำสั่ง user "ทำ Demand 15 นาที · เป้า 1600 kW"
-- ค่าตั้งรายตู้ (panel = ข้อความเดียวกับ energy_live_meters.panel) — ตอนนี้มีแค่เป้า Demand 15 นาที
-- client อ่านอย่างเดียว (DR = anon เสมอ) · เขียนผ่าน edge energy-meter-admin (ตรวจ has_perm('energy:record') ฝั่ง Main)
-- ไม่มีแถว / เป้าว่าง = การ์ดเขียนว่า "ยังไม่ได้ตั้งเป้า" (ห้ามเดา)
-- ย้อน: drop table public.energy_panel_settings;
create table if not exists public.energy_panel_settings (
  panel             text primary key,
  demand_target_kw  numeric check (demand_target_kw is null or demand_target_kw > 0),
  updated_at        timestamptz not null default now(),
  updated_by        text
);
alter table public.energy_panel_settings enable row level security;
drop policy if exists energy_panel_settings_read on public.energy_panel_settings;
create policy energy_panel_settings_read on public.energy_panel_settings for select to anon, authenticated using (true);
grant select on public.energy_panel_settings to anon, authenticated;

-- ตู้ MDB (HDF) = "ตู้ MDB" ของ Node-RED HDF (เป้า 1,600 kW ตามจอ Node-RED · user ยืนยัน 25/11)
insert into public.energy_panel_settings (panel, demand_target_kw, updated_by)
values ('MDB (HDF)', 1600, 'migration 25/11 (คำสั่ง user)')
on conflict (panel) do nothing;
