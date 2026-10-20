-- DR project (eyhclzkifitbhbljgoav · "Product DB") — 2026-10-20 · คำสั่ง user "ข้อ 6-7 ลุยเลย"
-- ✅ สถานะ 20/10: user รันใน SQL Editor แล้ว (เช็คแล้ว: ผูก 9 ประเภท · brand มี · ซ่อน 3 ชื่อ)
--
-- ข้อ 6 · ชนิดอุปกรณ์ในใบ MO มาจาก "ประเภทเครื่อง" ของ MC No. (ไม่ให้แต่ละทีมพิมพ์ชื่อเอง)
--   machine_types.mo_item_type = ชื่อใน mtn_item_types (จับคู่ด้วยข้อความ แบบเดียวกับ die_set_kinds.mo_item_type)
--   seed เฉพาะคู่ที่ประวัติใบ MO ชี้ชัด (วัด 19/10 · ชนะขาด) — ก้ำกึ่ง (Metal Forming/Gripper/Stan Gun) เว้นว่างให้คนตั้ง
--   ชื่อกลาง (ไม่มียี่ห้อ) ของหุ่นยนต์/สเตชั่น เปิดให้ทีม MTN เห็นด้วย (shared_teams) — ไม่เปลี่ยนชื่อ ไม่ลบอะไร
--   ซ่อน (is_active=false) เฉพาะชื่อมียี่ห้อที่ **ไม่เคยมีใบ MO ใช้เลย** 3 ตัว — ตัวที่มีคนใช้ยังอยู่ (ค่อยๆ ซ่อน)
-- ข้อ 7 · ยี่ห้อ = คุณสมบัติของเครื่อง → machines.brand (เติมจากชื่อเครื่องผ่านจอ "แยกยี่ห้อ" ให้คนตรวจก่อนบันทึก)
--
-- ย้อนกลับ: alter table machines drop column brand; alter table machine_types drop column mo_item_type;
--          update mtn_item_types set is_active=true where name in (...3 ตัวด้านล่าง);
--          update mtn_item_types set shared_teams = array_remove(shared_teams,'maintenance') where name in (...ชื่อกลาง);
begin;
set local lock_timeout = '5s';

alter table public.machines      add column if not exists brand text;
alter table public.machine_types add column if not exists mo_item_type text;

update public.machine_types t set mo_item_type = v.it
  from (values
    ('Robot - Handling',   'ROBOT HANDLING'),
    ('Robot-ArcWelding',   'ROBOT ARC WELD'),
    ('Robot-Spotwelding',  'ROBOT SPOT WELD'),
    ('Projection Welding', 'STATIONARY'),
    ('Stationary',         'STATIONARY'),
    ('Conveyer-Part',      'CONVEYOR'),
    ('Laser Cutting',      'Laser [ เครื่องเลเซอร์ ]'),
    ('Bending',            'Bending [เครื่อง Bending]'),
    ('Jig fixture',        'JIG')
  ) as v(label, it)
 where t.label = v.label and t.mo_item_type is null
   and exists (select 1 from public.mtn_item_types i where i.name = v.it);

update public.mtn_item_types
   set shared_teams = (select array_agg(distinct x) from unnest(coalesce(shared_teams, '{}'::text[]) || array['maintenance']) x)
 where name in ('ROBOT HANDLING', 'ROBOT ARC WELD', 'ROBOT SPOT WELD', 'STATIONARY');

update public.mtn_item_types i set is_active = false
 where i.name in ('Robot Handling [ Yaskawa ]', 'Robot Spot [ Yaskawa ]', 'Stationary [ เครื่องสเตชั่น ]')
   and not exists (select 1 from public.mtn_orders o where o.item_type = i.name);

commit;

-- เช็คผล:
-- select label, mo_item_type from machine_types where mo_item_type is not null order by label;
-- select name, shared_teams, is_active from mtn_item_types where name ilike '%robot%' or name ilike '%station%' order by name;
-- select count(*) filter (where brand is not null) has_brand, count(*) total from machines;
