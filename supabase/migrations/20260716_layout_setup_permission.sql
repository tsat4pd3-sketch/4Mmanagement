-- สิทธิ์เข้าหน้า ตั้งค่าผัง/Floorplan (hub รวมการตั้งค่าผัง) — Main project
-- seed admin/manager/supervisor (เหมือน LineSetup) · admin bypass อยู่แล้ว · role อื่นเปิดจาก /permissions
insert into public.role_permissions (role, permission_key, allowed) values
  ('admin','page:/layout-setup',true),
  ('manager','page:/layout-setup',true),
  ('supervisor','page:/layout-setup',true)
on conflict (role, permission_key) do nothing;
