-- ปิดช่องว่างทะเบียนสิทธิ์ `permission_catalog` (2026-08-06 · จาก audit ระบบจัดการสิทธิ์)
--
-- ที่มา: หน้า /permissions แท็บ "สิทธิ์การทำงาน" render จาก `permission_catalog`
--   → key ที่โค้ดเช็คจริงแต่ไม่มีในทะเบียน = **มองไม่เห็นบนจอ ปรับไม่ได้** (แก้ได้ทางตารางเท่านั้น)
--   → key ที่อยู่ในทะเบียนแต่ไม่มีโค้ดไหนเช็ค = ติ๊กแล้วไม่เกิดอะไร (หลอกคนตั้งค่า)
--
-- ⚠️ ไม่แตะ `role_permissions` เลย — สิทธิ์ที่แต่ละ role ถืออยู่ "ไม่เปลี่ยนแม้แต่แถวเดียว"
--    migration นี้แค่ทำให้ key ที่ทำงานอยู่แล้วโผล่ให้ตั้งค่าได้
--
-- ROLLBACK:
--   delete from permission_catalog where (resource,action) in (
--     ('lpa','record'),('lpa','manage'),('lpa','delete'),('transport','manage'),
--     ('pm_coord','manage'),('doc_forms','manage'),('ojt','record'),('ojt','delete'));
--   insert into permission_catalog (resource, action, label, group_name, sort) values
--     ('org','manage','แผนผังองค์กร: จัดการ','ตั้งค่าโปรแกรม,ฐานข้อมูล',88),
--     ('users','manage','ผู้ใช้งานระบบ: สร้าง/แก้ไข','ตั้งค่าโปรแกรม,ฐานข้อมูล',89),
--     ('permissions','manage','จัดการสิทธิ์: แก้ไข','ตั้งค่าโปรแกรม,ฐานข้อมูล',90);

-- 1) key ที่โค้ดใช้จริงแต่หายจากทะเบียน (8 ตัว)
insert into permission_catalog (resource, action, label, group_name, sort) values
  ('lpa',       'record', 'LPA: บันทึกผลตรวจ',              'ฝ่ายผลิต',                  220),
  ('lpa',       'manage', 'LPA: จัดการแผน/คำถาม',            'ฝ่ายผลิต',                  221),
  ('lpa',       'delete', 'LPA: ลบผลตรวจ',                   'ฝ่ายผลิต',                  222),
  ('transport', 'manage', 'ขนส่ง: มอบหมาย/จัดการคนขับ',      'Logistic - Store',          67),
  ('pm_coord',  'manage', 'แผนประสานงาน PM: จัดการ',         'การตรวจสอบและซ่อมบำรุง',    210),
  ('doc_forms', 'manage', 'ทะเบียนเอกสาร: แก้ไข',            'ตั้งค่าโปรแกรม,ฐานข้อมูล',  220),
  ('ojt',       'record', 'OJT: บันทึกใบอบรม',               'ตั้งค่าโปรแกรม,ฐานข้อมูล',  230),
  ('ojt',       'delete', 'OJT: ลบใบอบรม',                   'ตั้งค่าโปรแกรม,ฐานข้อมูล',  231)
on conflict (resource, action) do nothing;

-- 2) key ที่ไม่มีโค้ดไหนเช็ค — ติ๊กแล้วไม่มีผล (สิทธิ์จริงคุมด้วย role admin ตรงๆ)
--    ⚠️ ตรวจแล้วว่าไม่ใช่ key ที่ถูกเรียกแบบ dynamic (ต่างจาก event_log:approve_* / mtn_repair:approve
--       ที่ประกอบชื่อ key ตอน runtime — พวกนั้นห้ามลบ)
delete from permission_catalog
where (resource, action) in (('org','manage'), ('users','manage'), ('permissions','manage'));
