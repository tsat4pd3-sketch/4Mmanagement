-- ── Main project ──
-- ปิดช่องโหว่ทะเบียนสิทธิ์การทำงาน (permission_catalog) จาก audit ระบบจัดการสิทธิ์ 2026-08-06
--
-- ที่มา: เทียบ 3 ทาง (โค้ดที่เรียก can() ↔ ทะเบียน permission_catalog ↔ ข้อมูล role_permissions)
--   แล้วพบ 2 กลุ่มที่ไม่ตรงกัน:
--
-- (1) 8 key ที่โค้ดใช้จริง + มีแถวใน role_permissions แล้ว แต่ "ไม่มีในทะเบียน"
--     → ไม่ขึ้นในตารางแท็บ "สิทธิ์การทำงาน" ของหน้า /permissions
--     → สิทธิ์ล็อกตายตามที่ migration seed ไว้ admin ปรับเองไม่ได้เลย
--
-- (2) 3 key ที่อยู่ในทะเบียน แต่ "ไม่มีโค้ดไหนเรียกใช้"
--     → ติ๊กแล้วไม่มีผลจริง (3 หน้านี้คุมด้วย page permission + admin-only อยู่แล้ว)
--
-- ⚠️ migration นี้ไม่เปลี่ยนสิทธิ์ของใครเลย — แตะแค่ "ทะเบียนรายการที่โผล่ให้ตั้งค่า"
--    ค่าจริงอยู่ใน role_permissions ซึ่งไม่ถูกแตะ (ทั้ง insert และ delete)

-- ── (1) เพิ่ม key ที่ขาด ────────────────────────────────────────────────
-- group_name/sort ยึด convention เดิม: ต่อท้าย sort สูงสุดของกลุ่มนั้น
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  -- LPA (Layer Process Audit) — หน้าอยู่หมวดฝ่ายผลิต
  ('lpa',        'record',        'LPA: บันทึกผลตรวจ',                'ฝ่ายผลิต',                 220),
  ('lpa',        'manage',        'LPA: จัดการแผน/คำถาม',             'ฝ่ายผลิต',                 221),
  ('lpa',        'delete',        'LPA: ลบผลตรวจ/แผน',                'ฝ่ายผลิต',                 222),
  -- ขนส่ง (Teiki-bin) — หน้าอยู่หมวด Logistic
  ('transport',  'manage',        'ขนส่ง: มอบหมายคนขับ/ยานพาหนะ',     'Logistic - Store',         67),
  -- PM ประสานงานข้ามวัน
  ('pm_coord',   'manage',        'PM ประสานงาน: สร้าง/แก้/แจ้ง Production', 'การตรวจสอบและซ่อมบำรุง', 210),
  -- เอกสาร & ฟอร์ม + OJT — จัดกลุ่มเดียวกับ employees/skills ที่มีอยู่เดิม
  ('doc_forms',  'manage',        'ทะเบียนเอกสาร: แก้เลขฟอร์ม/Rev/ลายเซ็น', 'ตั้งค่าโปรแกรม,ฐานข้อมูล', 220),
  ('ojt',        'record',        'OJT: บันทึกใบอบรม',                'ตั้งค่าโปรแกรม,ฐานข้อมูล', 230),
  ('ojt',        'delete',        'OJT: ลบใบอบรม',                    'ตั้งค่าโปรแกรม,ฐานข้อมูล', 231)
on conflict (resource, action) do nothing;

-- ── (2) ลบ key ที่ไม่มีโค้ดเรียกใช้ (ติ๊กแล้วไม่มีผล) ──────────────────
-- org:manage        → /org-setup   คุมด้วย page:/org-setup (admin เท่านั้น)
-- users:manage      → /add-user    คุมด้วย page:/add-user + Edge Function admin-only
-- permissions:manage→ /permissions คุมด้วย page:/permissions (admin เท่านั้น)
-- ลบเฉพาะจากทะเบียน (รายการที่โผล่ให้ติ๊ก) — แถวใน role_permissions คงไว้ เผื่อ rollback
delete from public.permission_catalog
 where (resource, action) in (('org','manage'), ('users','manage'), ('permissions','manage'));

-- rollback:
--   delete from permission_catalog where resource in ('lpa','transport','pm_coord','doc_forms','ojt');
--   insert into permission_catalog (resource, action, label, group_name, sort) values
--     ('org','manage','แผนผังองค์กร: จัดการ','ตั้งค่าโปรแกรม,ฐานข้อมูล',88),
--     ('users','manage','ผู้ใช้งานระบบ: สร้าง/แก้ไข','ตั้งค่าโปรแกรม,ฐานข้อมูล',89),
--     ('permissions','manage','จัดการสิทธิ์: แก้ไข','ตั้งค่าโปรแกรม,ฐานข้อมูล',90);
