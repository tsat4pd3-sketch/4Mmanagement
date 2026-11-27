-- ⚡ Project: DR ("Product DB" · eyhclzkifitbhbljgoav) — 2026-11-26 คำสั่ง user "ทำ Baseline พักเที่ยงต่อเลย"
-- ช่วงเวลา baseline ต่อตู้ (เวลาไทย · ช่วงพักที่เครื่องควรเบา ⇒ ไฟที่ยังกินอยู่ = โหลดพื้นฐาน/รั่ว)
-- ว่าง = การ์ดเขียน "ยังไม่ได้ตั้งช่วง baseline" (ห้ามเดาเวลา) · เขียนผ่าน edge energy-meter-admin (panel_target)
-- ย้อน: alter table public.energy_panel_settings drop column baseline_start, drop column baseline_end;
alter table public.energy_panel_settings
  add column if not exists baseline_start time,
  add column if not exists baseline_end time;
alter table public.energy_panel_settings drop constraint if exists energy_panel_settings_baseline_chk;
alter table public.energy_panel_settings add constraint energy_panel_settings_baseline_chk
  check ((baseline_start is null) = (baseline_end is null) and (baseline_start is null or baseline_start < baseline_end));

-- ตู้ MDB (HDF) = ช่วงเดียวกับการ์ด "Baseline พักเที่ยง (12:00–12:50)" ของจอ Node-RED HDF
update public.energy_panel_settings set baseline_start = '12:00', baseline_end = '12:50'
 where panel = 'MDB (HDF)' and baseline_start is null;
