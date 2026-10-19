-- DR project ("Product DB" · eyhclzkifitbhbljgoav) · 2026-10-19 · คำสั่ง user "ทำบอร์ดไลน์ปั๊มให้ล้าง 21 ช่องนั้นด้วย"
-- ช่อง IN ที่กรอกมือบนบอร์ดไลน์ปั๊ม (29/09–08/10) — ตรวจกับกติกาล็อก (`lockFromByMat` · monitorSystem.js) แล้ว
-- มีแค่ 10 ช่องที่ทับวันที่ระบบมีตัวเลข (คลังรับเข้า / Daily Report ลงยอด) ⇒ ลบเฉพาะ 10 ช่องนี้
-- อีก 11 ช่อง = พาร์ทที่ระบบยังไม่มีข้อมูล หรือวันก่อนระบบเริ่ม ⇒ กรอกมือได้ตามกติกา **ไม่แตะ**
create schema if not exists archive;
create table if not exists archive.monitor_cells_locked_in_20261019 as
  select * from public.monitor_cells where id in (
    '28ef0349-7ad1-425e-900c-8bb8c6788103','3786c470-1d77-44a2-8ebf-9fe6063abce5','d7bbc75e-5207-4943-87b7-8db56296269d',
    'ad71e093-b759-4908-96b8-9b05f48308fd','26d96174-2730-4ca3-ba01-13a80f4b7cc0','f16b17a2-29f0-4769-af64-f61065284cc0',
    '8f97aa46-3464-40cf-9536-f20877fc32d2','8b1da1ce-0b4c-4266-88d0-958c52770a40','3973d02c-22a1-4a70-8df9-d4f29ccedb52',
    '846b80ab-91f3-4b11-8c9d-daaf45b1cd5b');
alter table archive.monitor_cells_locked_in_20261019 enable row level security;
delete from public.monitor_cells where id in (select id from archive.monitor_cells_locked_in_20261019);
-- เช็คผล: select count(*) from archive.monitor_cells_locked_in_20261019;  -- 10
--         select count(*) from monitor_cells c join monitor_board_parts p on p.id=c.board_part_id join monitor_boards b on b.id=p.board_id where b.kind='line' and c.row_key='in';  -- 11
-- ย้อน:   insert into public.monitor_cells select * from archive.monitor_cells_locked_in_20261019;
