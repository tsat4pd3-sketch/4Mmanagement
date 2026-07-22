-- Separate "delete" permissions for high-value, hard-to-recover data.
-- Target project: main (ewhdfqwfwofivojtsizn).
--
-- Why: deleting a line, a shift, a scrap report, an MO, or a Kaizen project used to
-- be bundled into the "edit"/"manage" permission — so anyone who could edit could also
-- delete. As more departments/users start using the system, delete should be its own
-- gate so an admin can grant "edit but not delete" (least privilege).
--
-- PURELY ADDITIVE. The client uses canDelete(resource, fallbackAction, role):
--   • before this migration is applied → these keys aren't seeded → it falls back to the
--     old bundled permission, so behavior is unchanged (deploy-safe, no gap).
--   • after this migration → it uses the separate `${resource}:delete` key below.
-- Default holders = admin + manager only (tightens delete). Admin can widen per-role
-- from the จัดการสิทธิ์ page afterwards.

with cat(resource, action, label, group_name, sort, allowed_roles) as (
  values
  ('line_setup',    'delete', 'ผังไลน์: ลบไลน์/จุดงาน/WIP',        'ตั้งค่าโปรแกรม,ฐานข้อมูล', 200, array['admin','manager']),
  ('shift_schedule','delete', 'ตารางกะ: ลบ override / ยุบกะ',      'ตั้งค่าโปรแกรม,ฐานข้อมูล', 201, array['admin','manager']),
  ('scrap',         'delete', 'Scrap: ลบใบรายงานของเสีย',          'รายงาน/คุณภาพ',            202, array['admin','manager']),
  ('mtn_repair',    'delete', 'MTN: ลบใบซ่อม MO',                  'การตรวจสอบและซ่อมบำรุง',   203, array['admin','manager']),
  ('improvements',  'delete', 'Kaizen: ลบโปรเจคปรับปรุง',          'ฝ่ายผลิต',                 204, array['admin','manager'])
),
ins_cat as (
  insert into permission_catalog (resource, action, label, group_name, sort)
  select resource, action, label, group_name, sort from cat
  on conflict (resource, action) do nothing
  returning 1
)
insert into role_permissions (role, permission_key, allowed)
select r.role,
       cat.resource || ':' || cat.action,
       (r.role::text = any(cat.allowed_roles))
from cat
cross join (select unnest(array['admin','manager','supervisor','leader','qa','document_control','sale','mtn','engineer','planner_store','display']::user_role[]) as role) r
on conflict (role, permission_key) do nothing;
