-- DR project (eyhclzkifitbhbljgoav · "Product DB") — 2026-10-19 · คำสั่ง user "ลบที่ปิดใช้ได้เลย"
-- ลบแถว machines ที่ is_active=false (63 แถว · ส่วนใหญ่เป็นแถวเก่าที่มีตัวใช้งาน MC No. เดียวกันแทนแล้ว)
-- ⚠️ สถานะ 19/10: apply แล้วเฉพาะ (1) สำรอง archive.* (2) ย้าย jigs 3 ตัว · **ขั้น delete ยังไม่สำเร็จ** (MCP timeout ทุกครั้ง แม้ลบทีละแถว — ยังหาสาเหตุไม่เจอ)
-- 🔴 FK ที่ชี้ machines: equipment_die/fixture_points (ON DELETE CASCADE) · jigs (SET NULL) — เช็ค 19/10:
--    equipment_die 0 · fixture_points 0 · pm_coordination_plans/checklists/facility_supply_links 0 · jigs 4
--    ⇒ jigs 3 ตัวย้ายไปชี้แถวใช้งานที่ MC No. เดียวกัน (machine_key) · JHYD06-14/15 ไม่มีตัวแทน = **ไม่ลบ** (ลบ = จิ๊กหลุดเครื่องเงียบ)
-- ใบ MO / downtime ผูกด้วย machine_no (ข้อความ) ไม่ใช่ id ⇒ ไม่กระทบ
-- สำรองทั้งแถวไว้ใน schema archive ก่อนลบ (กฎ: copy กันพลาดห้ามอยู่ public)
-- ย้อนกลับ: insert into public.machines select * from archive.machines_inactive_20261019;
--          แล้วคืน jigs.machine_id จาก archive.jigs_repoint_20261019
begin;
set local lock_timeout = '5s';
create schema if not exists archive;
create table archive.machines_inactive_20261019 as select * from public.machines where not is_active;
create table archive.jigs_repoint_20261019 as
  select j.id as jig_id, j.machine_id as old_machine_id,
         (select a.id from public.machines a where a.is_active and public.machine_key(a.machine_no) = public.machine_key(d.machine_no)) as new_machine_id
    from public.jigs j join public.machines d on d.id = j.machine_id where not d.is_active;
update public.jigs j set machine_id = r.new_machine_id
  from archive.jigs_repoint_20261019 r where r.jig_id = j.id and r.new_machine_id is not null;
delete from public.machines m
 where not m.is_active
   and not exists (select 1 from public.jigs j where j.machine_id = m.id)
   and not exists (select 1 from public.equipment_die e where e.machine_id = m.id)
   and not exists (select 1 from public.fixture_points f where f.machine_id = m.id);
commit;
-- เช็คผล: select count(*) filter (where not is_active) inactive, count(*) total from machines;
