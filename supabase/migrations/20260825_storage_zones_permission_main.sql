-- ═══ สิทธิ์จัดการโซนคลังสินค้า (WMS เฟส 1 · 2026-08-25) ═══
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- key ใหม่ storage:manage — เพิ่ม/แก้โซนจัดเก็บ + ผูก MAT + ความจุ (ตาราง storage_zones ฝั่ง DR)
-- ลงทะเบียนครบ 2 ที่ตามกฎ: permission_catalog (โผล่ใน /permissions) + seed role_permissions
-- seed ระบุ role ตรงๆ (เลี่ยงกับดัก enum_range) — งานคลังเป็นของฝ่าย Logistic & Sales:
--   planner_store + sale ได้ด้วย (ตามผัง ORG001: Store/W&H อยู่ฝ่ายเดียวกัน) + dept_admin bucket
-- การ "ดู" ไม่ต้องมี key — แท็บโซนใน /line-stock เห็นทุก role ที่เข้าหน้าได้ (read-only)
--
-- Rollback: delete from role_permissions where permission_key = 'storage:manage';
--           delete from permission_catalog where resource = 'storage' and action = 'manage';

insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'storage', 'manage', 'โซนคลังสินค้า: จัดการโซน/ผูก MAT/ความจุ', 'Logistic - Store', 69
where not exists (select 1 from public.permission_catalog where resource = 'storage' and action = 'manage');

insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'storage:manage', true
from (values ('admin'::user_role),('manager'::user_role),('supervisor'::user_role),
             ('planner_store'::user_role),('sale'::user_role),('dept_admin'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp
                  where rp.role = r.role and rp.permission_key = 'storage:manage');

-- ตรวจหลังรัน:
-- select role, allowed from role_permissions where permission_key='storage:manage' order by role;  -- 6 แถว
-- select label, group_name, sort from permission_catalog where resource='storage';
