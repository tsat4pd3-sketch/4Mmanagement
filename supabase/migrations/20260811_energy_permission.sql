-- สิทธิ์หน้าพลังงานไฟฟ้า (Main project) · 2026-08-11
--
-- ⚠️ กับดัก enum_range: seed ด้วย enum_range(user_role) ล็อกรายชื่อ role ณ เวลานี้
--    role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าไม่ได้ (fail-closed) → admin ติ๊กเพิ่มที่ /permissions ได้
--    ที่นี่ตั้งใจ seed page ให้ทุก role (ค่าไฟเป็นเรื่องที่ผู้บริหาร/ผลิต ควรเห็น)
--    ส่วนสิทธิ์ "กรอก" ให้เฉพาะทีมที่รับผิดชอบ

insert into public.permission_catalog (resource, action, label, group_name, sort)
values ('energy', 'record', 'กรอกค่าพลังงานรายเดือน', 'ซ่อมบำรุง', 70)
on conflict do nothing;

-- เข้าดูหน้าได้ทุก role
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/energy', true from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;

-- กรอกได้: admin / manager / ซ่อมบำรุง / วิศวกรรม (+ bucket dept_admin ตามแนวทางแอดมินหน่วยงาน)
insert into public.role_permissions (role, permission_key, allowed)
values
  ('admin',       'energy:record', true),
  ('manager',     'energy:record', true),
  ('mtn',         'energy:record', true),
  ('engineer',    'energy:record', true),
  ('dept_admin',  'energy:record', true)
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- Rollback:
--   delete from public.role_permissions where permission_key in ('page:/energy','energy:record');
--   delete from public.permission_catalog where resource = 'energy';
