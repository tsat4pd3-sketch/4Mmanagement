-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- แก้ gap ชนิดเดิม (QC audit กฎ C2 — เหมือน line_stock:approve, improvements:manage):
-- `mtn_repair:*` 5 keys seed ลง role_permissions (20260714_mtn_work_order_permissions.sql)
-- แต่ไม่มีแถวใน permission_catalog → แท็บ Actions ของหน้าจัดการสิทธิ์มองไม่เห็น
-- admin ปรับสิทธิ์ workflow ใบแจ้งซ่อม MO จาก UI ไม่ได้

insert into permission_catalog (resource, action, label, group_name, sort) values
  ('mtn_repair', 'report',        'แจ้งซ่อม MO (step 1) + รับมอบ/ติดตาม (step 6)', 'การตรวจสอบและซ่อมบำรุง', 103),
  ('mtn_repair', 'service',       'รับงาน/ซ่อม/ตรวจหลังซ่อม (step 2-4)',           'การตรวจสอบและซ่อมบำรุง', 104),
  ('mtn_repair', 'qa',            'คุณภาพหลังซ่อม (step 5)',                        'การตรวจสอบและซ่อมบำรุง', 105),
  ('mtn_repair', 'approve',       'อนุมัติปิด MO (step 7)',                          'การตรวจสอบและซ่อมบำรุง', 106),
  ('mtn_repair', 'manage_master', 'จัดการช่าง/อะไหล่/taxonomy + ลบใบซ่อม',           'การตรวจสอบและซ่อมบำรุง', 107)
on conflict (resource, action) do nothing;
