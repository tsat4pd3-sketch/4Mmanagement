-- 5S: เปิดสิทธิ์แก้ข้อมูล 5S (act_5s:manage) ให้ role manager · 2026-11-28 · loop smf01
-- คำสั่ง user 28/11 ("คลิกแล้วต้องเพิ่ม แก้ไข ลบ ได้" — บัญชี manager กดไม่ได้เพราะยังไม่มี role ไหนถือสิทธิ์นี้ นอกจาก admin)
-- ปรับ/ปิดภายหลังได้ที่หน้า /permissions (แถวเดียวกัน) · ย้อนกลับ: update ... set allowed = false where role = 'manager' and permission_key = 'act_5s:manage'
insert into public.role_permissions (role, permission_key, allowed)
values ('manager', 'act_5s:manage', true)
on conflict (role, permission_key) do update set allowed = excluded.allowed, updated_at = now();
