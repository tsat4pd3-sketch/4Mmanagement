-- 🔧 FIXTURE SHIM — สิทธิ์ (Main project · 2026-09-01) — ✅ apply แล้ว 2026-09-01
--
-- ลงทะเบียนครบ 2 ที่ตามกฎ: permission_catalog (action โผล่ใน /permissions) + seed role_permissions
-- ⚠️ seed ระบุ role ตรงๆ **ห้ามใช้ enum_range** — ไม่งั้น role ที่เพิ่มทีหลังเข้าไม่ได้แบบ fail-closed
--
-- ⚠️ `page:*` **ไม่เข้า permission_catalog** — แท็บ "การเข้าถึงหน้า" ของ /permissions อ่านจาก
--    PAGE_GROUPS ในโค้ด (PermissionsManagement.jsx) ส่วน catalog ใช้กับแท็บ "สิทธิ์การทำงาน"
--    ใส่ทั้ง 2 ที่ = แถวเดียวโผล่ 2 แท็บ (ตรวจแล้ว: ทั้งตารางไม่มีแถว resource='page' เลย)
--
-- การ "ดู" ไม่ต้องมี action key — หน้า/แท็บเห็นได้ทุก role ที่มี page:/fixture (read-only)
--
-- Rollback:
--   delete from role_permissions where permission_key in
--     ('fixture_shim:record','fixture_shim:approve','fixture_point:manage','page:/fixture');
--   delete from permission_catalog where resource in ('fixture_shim','fixture_point');

insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('fixture_shim',  'record',  'Fixture: บันทึกการใส่/ถอดชิม',                'การตรวจสอบและซ่อมบำรุง', 635),
  ('fixture_shim',  'approve', 'Fixture: อนุมัติการใส่ชิม (หัวหน้าช่าง JIG)',  'การตรวจสอบและซ่อมบำรุง', 636),
  ('fixture_point', 'manage',  'Fixture: จัดการทะเบียนจุด + baseline + เกณฑ์',  'การตรวจสอบและซ่อมบำรุง', 637)
on conflict do nothing;

-- บันทึกชิม + จัดการจุด = ทีมช่าง (role mtn ครอบ JIG/DIE/MTN — แยกทีมจริงด้วย profiles.mtn_teams)
insert into public.role_permissions (role, permission_key, allowed)
select r.role, k.key, true
from (values ('admin'::user_role),('manager'::user_role),('mtn'::user_role)) as r(role)
cross join (values ('fixture_shim:record'),('fixture_point:manage')) as k(key)
where not exists (select 1 from public.role_permissions rp
                  where rp.role = r.role and rp.permission_key = k.key);

-- อนุมัติ = หัวหน้าช่าง JIG (user เคาะ) — seed admin/manager ก่อน
-- แล้ว admin ติ๊กเพิ่มให้ role ที่หัวหน้าช่างใช้เองที่ /permissions (คุมรายคนซ้ำด้วย profiles.mtn_teams)
insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'fixture_shim:approve', true
from (values ('admin'::user_role),('manager'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp
                  where rp.role = r.role and rp.permission_key = 'fixture_shim:approve');

-- เข้าหน้า /fixture — ทุก role (ดูอย่างเดียว) · ปรับปิดได้ที่ /permissions
-- ⚠️ ต้องเพิ่ม page:/fixture ใน PAGE_GROUPS (PermissionsManagement.jsx) ในคอมมิทเดียวกับ route
--    ไม่งั้น admin ปรับสิทธิ์หน้านี้จาก UI ไม่ได้เลย (กฎ C6)
insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'page:/fixture', true
from (values ('admin'::user_role),('manager'::user_role),('supervisor'::user_role),('leader'::user_role),
             ('mtn'::user_role),('engineer'::user_role),('qa'::user_role),('planner_store'::user_role),
             ('sale'::user_role),('document_control'::user_role),('display'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp
                  where rp.role = r.role and rp.permission_key = 'page:/fixture');

-- ตรวจหลังรัน (ผลจริง 2026-09-01):
-- select count(*) from role_permissions
--  where permission_key like 'fixture%' or permission_key = 'page:/fixture';   -- 19
-- select count(*) from permission_catalog where resource = 'page';             -- 0 เสมอ
