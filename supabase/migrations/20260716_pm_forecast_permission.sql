-- สิทธิ์เข้าหน้า PM ล่วงหน้า (Planner) — Main project (ewhdfqwfwofivojtsizn)
-- seed ทุก role (ดูได้ทุกคนเหมือนหน้า PM อื่น) · ⚠️ role ที่เพิ่มทีหลังต้อง seed เพิ่มเอง (fail-closed)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/pm-forecast', true from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;
