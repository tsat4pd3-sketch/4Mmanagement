-- 📢 ประกาศบริษัท (Mockup) /announcements — เปิดสิทธิ์เข้าหน้าให้ manager · 2026-10-29 (คำสั่ง user) · project: Main
-- หน้า mockup ไม่เขียน DB · admin ผ่านทุกหน้าอยู่แล้วในโค้ด (hasPermission) จึง seed แค่ manager
-- role อื่นเปิดเพิ่มได้เองจากหน้า /permissions
-- ย้อน: delete from public.role_permissions where role = 'manager' and permission_key = 'page:/announcements';
insert into public.role_permissions (role, permission_key, allowed)
values ('manager', 'page:/announcements', true)
on conflict (role, permission_key) do nothing;
