-- สิทธิ์ action ของหน้า Delivery / Planner & Sales — ย้ายจาก hardcode role array ในโค้ด
-- ★ Applied on MAIN project (ewhdfqwfwofivojtsizn) via MCP — ไฟล์นี้เก็บไว้เป็นประวัติ
--   shipping:config = จัดการ Ship-to Config (CustomerDemand.jsx เดิม hardcode admin/manager/sale/supervisor)
--   demand:upload   = อัพโหลด Forecast/Order (PlannerSales.jsx เดิม hardcode admin/manager/sale)

with cat as (
  select * from (values
    ('shipping', 'config', 'Delivery: จัดการ Ship-to Config (เพิ่ม/แก้/ลบ code)', 'Logistic - Store', 64, array['admin','manager','sale','supervisor']),
    ('demand',   'upload', 'Planner & Sales: อัพโหลด/ลบ Forecast·Order จากลูกค้า', 'Logistic - Store', 65, array['admin','manager','sale'])
  ) as t(resource, action, label, group_name, sort, allowed_roles)
),
ins_cat as (
  insert into permission_catalog (resource, action, label, group_name, sort)
  select resource, action, label, group_name, sort from cat
  on conflict (resource, action) do nothing
  returning 1
)
insert into role_permissions (role, permission_key, allowed)
select r.role, cat.resource || ':' || cat.action, (r.role::text = any(cat.allowed_roles))
from cat
cross join (select unnest(array['admin','manager','supervisor','leader','qa','document_control','display','sale']::user_role[]) as role) r
on conflict (role, permission_key) do nothing;

-- Rollback:
--   delete from role_permissions where permission_key in ('shipping:config','demand:upload');
--   delete from permission_catalog where (resource, action) in (('shipping','config'),('demand','upload'));
