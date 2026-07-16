-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- แก้ 🟡 จาก QC audit (กฎ C2): seed `line_stock:approve` (20260708_line_stock_approve_permission.sql)
-- ลง role_permissions อย่างเดียวแต่ไม่ได้ insert permission_catalog → แท็บ Actions ของหน้า
-- จัดการสิทธิ์ render จาก catalog เท่านั้น ทำให้ admin มองไม่เห็น/ปรับสิทธิ์นี้จาก UI ไม่ได้
-- (ขัด PERMISSIONS-DESIGN.md §2.2: เพิ่มฟีเจอร์ = catalog 1 แถว + seed role_permissions)

insert into permission_catalog (resource, action, label, group_name, sort)
values ('line_stock', 'approve', 'อนุมัติ/ปฏิเสธรายการ Stock รอตรวจ', 'Logistic - Store', 66)
on conflict (resource, action) do nothing;
