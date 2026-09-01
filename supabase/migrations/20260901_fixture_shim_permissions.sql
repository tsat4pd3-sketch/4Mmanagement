-- 🔧 FIXTURE SHIM — สิทธิ์ (Main project · 2026-09-01) — ⚠️ ร่าง ยังไม่ apply
--
-- ลงทะเบียนครบ 2 ที่ตามกฎ: permission_catalog (โผล่ใน /permissions) + seed role_permissions
-- ⚠️ seed ระบุ role ตรงๆ **ห้ามใช้ enum_range** — ไม่งั้น role ที่เพิ่มทีหลังเข้าไม่ได้แบบ fail-closed
--
-- การ "ดู" ไม่ต้องมี key — หน้า/แท็บเห็นได้ทุก role ที่เข้าหน้าได้ (read-only)
--
-- Rollback:
--   delete from role_permissions where permission_key in
--     ('fixture_shim:record','fixture_shim:approve','fixture_point:manage');
--   delete from permission_catalog where resource in ('fixture_shim','fixture_point');

insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('fixture_shim',  'record',  'Fixture: บันทึกการใส่/ถอดชิม',              'การตรวจสอบและซ่อมบำรุง', 635),
  ('fixture_shim',  'approve', 'Fixture: อนุมัติการใส่ชิม (หัวหน้าช่าง JIG)', 'การตรวจสอบและซ่อมบำรุง', 636),
  ('fixture_point', 'manage',  'Fixture: จัดการทะเบียนจุด + baseline + เกณฑ์', 'การตรวจสอบและซ่อมบำรุง', 637)
on conflict do nothing;

-- บันทึกชิม + จัดการจุด = ทีมช่าง (role mtn ครอบ JIG MTN / DIE MTN / MTN — แยกทีมด้วย profiles.mtn_teams)
insert into public.role_permissions (role, permission_key, allowed)
select r.role, k.key, true
from (values ('admin'::user_role),('manager'::user_role),('mtn'::user_role)) as r(role)
cross join (values ('fixture_shim:record'),('fixture_point:manage')) as k(key)
where not exists (select 1 from public.role_permissions rp
                  where rp.role = r.role and rp.permission_key = k.key);

-- อนุมัติ = หัวหน้าช่าง JIG (user เคาะ §8) — ให้ admin/manager ไปก่อน
-- แล้ว admin ติ๊กเพิ่มให้ตัวหัวหน้าช่างเองที่ /permissions (คุมรายคนด้วย profiles.mtn_teams ซ้ำอีกชั้น)
insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'fixture_shim:approve', true
from (values ('admin'::user_role),('manager'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp
                  where rp.role = r.role and rp.permission_key = 'fixture_shim:approve');

-- ⚠️ ถ้าทำหน้าใหม่ /fixture ต้องเพิ่ม page:/fixture ที่นี่ **และ** ใน PAGE_GROUPS
--    (src/pages/PermissionsManagement.jsx) ในคอมมิทเดียวกับ route ไม่งั้น admin ปรับสิทธิ์ไม่ได้เลย

-- ตรวจหลังรัน:
-- select role, permission_key from role_permissions
--  where permission_key like 'fixture_%' order by permission_key, role;   -- 8 แถว
-- select resource, action, label, sort from permission_catalog where resource like 'fixture_%';
