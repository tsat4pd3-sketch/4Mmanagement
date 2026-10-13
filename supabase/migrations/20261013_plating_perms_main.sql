-- ═══ 🧪 งานชุบภายนอก — สิทธิ์ปุ่มบนแท็บ "งานชุบ" ใน /heijunka (2026-10-13) ═══
-- Project: MAIN ("MAIN" · ewhdfqwfwofivojtsizn) · คู่กับ 20261013_plating_loop_dr.sql (ฝั่ง DR)
-- จอใช้ canSeeded() ⇒ โค้ดขึ้นก่อน migration = ดูอย่างเดียว ไม่พัง
-- เปิดวงแคบก่อน (admin bypass อยู่แล้ว) · ขยายได้ที่ /permissions โดยไม่ต้อง deploy · ⚠️ ระบุ role ชัด ห้าม enum_range
--
-- ย้อน:
--   delete from role_permissions where permission_key like 'plating:%';
--   delete from permission_catalog where resource = 'plating';

insert into public.role_permissions (role, permission_key, allowed)
select r, k, true
from unnest(array['planner_store','manager']::user_role[]) r
cross join unnest(array['plating:send','plating:receive','plating:to_wh','plating:setup']) k
on conflict (role, permission_key) do nothing;

-- ส่งเข้า W/H: ฝั่งคลังสินค้าสำเร็จรูปกดได้ด้วย
insert into public.role_permissions (role, permission_key, allowed)
values ('warehouse_delivery', 'plating:to_wh', true)
on conflict (role, permission_key) do nothing;

-- ตัดยอดค้างร้าน (สิ้นปี) = กระทบยอดบัญชี ⇒ ผู้จัดการเท่านั้น
insert into public.role_permissions (role, permission_key, allowed)
values ('manager', 'plating:writeoff', true)
on conflict (role, permission_key) do nothing;

insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('plating', 'send',     'งานชุบ: ส่งงานก่อนชุบออกไปร้านชุบ',                       'Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)', 511),
  ('plating', 'receive',  'งานชุบ: รับงานหลังชุบคืนเข้าคลัง (ทยอยรับได้)',            'Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)', 512),
  ('plating', 'to_wh',    'งานชุบ: ส่งงานหลังชุบเข้า W/H (แปลงเป็นเบอร์ 1xx ตาม BOM)', 'Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)', 513),
  ('plating', 'setup',    'งานชุบ: ตั้งเส้นทางชุบ (สินค้าหลังชุบ · ร้าน · BOM)',        'Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)', 514),
  ('plating', 'writeoff', 'งานชุบ: ตัดยอดค้างร้าน (สิ้นปี · ต้องมีเหตุผล)',            'Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)', 515)
on conflict (resource, action) do nothing;

-- ตรวจ:
--   select role::text, permission_key from role_permissions where permission_key like 'plating:%' order by 2, 1;
--   select resource, action, label from permission_catalog where resource = 'plating' order by sort;
