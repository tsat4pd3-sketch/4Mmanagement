-- สิทธิ์เข้าหน้า /die-registry (ทะเบียนแม่พิมพ์) — Main project
--
-- แยก "หน้าจอ" ออกจากฐานข้อมูลเครื่องจักร เพราะ 262/505 แถวใน machines เป็นแม่พิมพ์
-- ที่ปนอยู่จนทะเบียนเครื่องจักรอ่านไม่รู้เรื่อง — แต่ **ไม่ได้แยกฐานข้อมูล**
-- (ตัวตนยังอยู่ machines · เหตุผลเต็มใน src/utils/equipmentKinds.js)
--
-- seed admin/manager/supervisor เท่ากับ /machine-database (คนกลุ่มเดียวกันดูแล)
--   + mtn เพิ่มด้วย เพราะ **ทีม DIE MTN คือเจ้าของแม่พิมพ์ตัวจริง** (role mtn เข้า /machine-database
--   ได้อยู่แล้วผ่าน migration 20260713_mtn_role.sql — ถ้าไม่ให้เข้าหน้านี้เท่ากับตัดคนที่ต้องใช้ที่สุดออก)
-- ⚠️ role อื่น (leader/engineer ฯลฯ) เปิดเองที่ /permissions
--
-- การ "แก้ไข" ในหน้านี้คุมด้วย machines:edit (สิทธิ์เดิม) ไม่มี permission key ใหม่
--   → เลี่ยงกับดัก seed ด้วย enum_range ที่ทำให้ role ซึ่งเพิ่มทีหลังไม่มีแถว = fail-closed
insert into public.role_permissions (role, permission_key, allowed) values
  ('admin','page:/die-registry',true),
  ('manager','page:/die-registry',true),
  ('supervisor','page:/die-registry',true),
  ('mtn','page:/die-registry',true)
on conflict (role, permission_key) do nothing;
