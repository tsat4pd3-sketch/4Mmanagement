-- Scrap Report permissions (หน้า /scrap-report) — MAIN project (ewhdfqwfwofivojtsizn)
-- page:/scrap-report = เข้าดู · scrap:record = สร้าง/แก้ใบ · scrap:manage = อนุมัติ/ลบ

insert into permission_catalog (resource, action, label, group_name, sort) values
  ('scrap', 'record', 'Scrap: สร้าง/แก้ใบรายงานของเสีย',       'รายงาน/คุณภาพ', 60),
  ('scrap', 'manage', 'Scrap: อนุมัติ/ลบใบรายงานของเสีย',      'รายงาน/คุณภาพ', 61)
on conflict (resource, action) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r::user_role, k, true
from (values
  ('page:/scrap-report', array['admin','manager','supervisor','leader','qa','document_control']),
  ('scrap:record',       array['admin','manager','supervisor','leader','qa']),
  ('scrap:manage',       array['admin','manager','qa'])
) as seed(k, roles)
cross join lateral unnest(seed.roles) as r
on conflict (role, permission_key) do nothing;
