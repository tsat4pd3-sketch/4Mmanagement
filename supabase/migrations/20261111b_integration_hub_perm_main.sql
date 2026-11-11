-- 🔌 ศูนย์เชื่อมต่อ — สิทธิ์ "จัดการต้นทาง" (เพิ่ม/เปลี่ยนรหัสลับ/พักการรับ)
-- Project: Main ("MAIN" · ewhdfqwfwofivojtsizn) · 2026-11-11
-- ด่านจริงอยู่ที่ edge `integration-admin` (ฝั่ง DR) ที่ถาม rpc has_perm('integration:manage') ของ Main
-- ค่าเริ่มต้น = admin เท่านั้น (has_perm ให้ admin อยู่แล้ว ไม่ต้อง seed แถว) · เปิดให้ role อื่นที่ /permissions
-- ย้อน: delete from role_permissions where permission_key='integration:manage';
--       delete from permission_catalog where resource='integration' and action='manage';

insert into permission_catalog (resource, action, label, group_name, sort)
values ('integration', 'manage', 'ศูนย์เชื่อมต่อ: เพิ่มต้นทาง / เปลี่ยนรหัสลับ / พักการรับข้อมูลจาก Node-RED',
        'ตั้งค่าโปรแกรม,ฐานข้อมูล', 919)
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

-- ตรวจ: select * from permission_catalog where resource='integration';
--       select * from v_permission_catalog_sort_drift;   -- ต้องว่าง
