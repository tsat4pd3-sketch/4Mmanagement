-- ⚡ Project: DR ("Product DB" · eyhclzkifitbhbljgoav)
-- ชื่อที่โชว์บนบอร์ดค่าไฟสด แยกจาก scope_name (คีย์ข้อมูล/ประวัติ · ห้ามเปลี่ยน) — 2026-11-23 คำสั่ง user
-- "ทำหน้าตั้งค่าตู้ในแท็บพลังงาน ให้ขึ้นชื่อ MDB-06" (scope 'Utility Hydrofroming' = มิเตอร์ MDB-06)
-- เขียนผ่าน edge function energy-meter-admin เท่านั้น (ตาราง client อ่านอย่างเดียว · DR anon)
-- ย้อน: alter table public.energy_live_meters drop column display_name, drop column updated_by;
alter table public.energy_live_meters
  add column if not exists display_name text,
  add column if not exists updated_by text;

update public.energy_live_meters set display_name = 'MDB-06'
 where scope_kind = 'zone' and scope_name = 'Utility Hydrofroming' and display_name is null;
