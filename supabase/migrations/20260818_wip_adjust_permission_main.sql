-- ═══ สิทธิ์ปุ่ม "นับจริง" ของแผง WIP ระหว่างขั้น (2026-08-18) ═══
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- key ใหม่ wip:adjust — บันทึกยอดนับจริง (baseline) ลง wip_adjustments ฝั่ง DR
-- ลงทะเบียนครบ 2 ที่ตามกฎ: permission_catalog (ให้โผล่ในหน้า /permissions) + seed role_permissions
-- seed แบบระบุ role ตรงๆ (เลี่ยงกับดัก enum_range ล็อกรายชื่อ role) — ดูแผง WIP เห็นทุก role อยู่แล้ว
--   ผ่าน page:/line-stock · key นี้คุมเฉพาะการกดบันทึกยอดนับจริง
--
-- Rollback: delete from role_permissions where permission_key = 'wip:adjust';
--           delete from permission_catalog where resource = 'wip' and action = 'adjust';

insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'wip', 'adjust', 'WIP ระหว่างขั้น: บันทึกยอดนับจริง', 'Logistic - Store', 68
where not exists (select 1 from public.permission_catalog where resource = 'wip' and action = 'adjust');

insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'wip:adjust', true
from (values ('admin'::user_role),('manager'::user_role),('supervisor'::user_role),('leader'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp
                  where rp.role = r.role and rp.permission_key = 'wip:adjust');
