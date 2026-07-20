-- ── Main project (ewhdfqwfwofivojtsizn) — 2026-07-16 ──
-- สิทธิ์หน้าผังรวมโรงงาน: เข้าดู = ทุก role · แก้ผัง (อัปโหลด/วาดกรอบ) = admin/manager/supervisor
insert into role_permissions (role, permission_key, allowed)
  select r::user_role, 'page:/factory-map', true from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed) values
  ('admin','factory_map:edit',true), ('manager','factory_map:edit',true), ('supervisor','factory_map:edit',true)
on conflict (role, permission_key) do nothing;

insert into permission_catalog (resource, action, label, group_name, sort) values
  ('factory_map','edit','ผังรวมโรงงาน: อัปโหลดผัง + วาดกรอบไลน์','ฝ่ายผลิต', 12)
on conflict (resource, action) do nothing;
