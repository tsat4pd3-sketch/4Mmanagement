-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- แก้ 🟡 จาก QC audit รอบ 3 (กฎ C2): `improvements:manage` seed ลง role_permissions
-- (20260712_improvements_page_permissions.sql) แต่ไม่ได้ insert permission_catalog
-- → แท็บ Actions ของหน้าจัดการสิทธิ์มองไม่เห็น key นี้ admin ปรับจาก UI ไม่ได้
-- (บั๊กชนิดเดียวกับ line_stock:approve ที่แก้ใน 20260714_line_stock_approve_catalog.sql)

insert into permission_catalog (resource, action, label, group_name, sort)
values ('improvements', 'manage', 'สร้าง/แก้ไข/ปิดโปรเจคปรับปรุง (Kaizen)', 'ฝ่ายผลิต', 29)
on conflict (resource, action) do nothing;
