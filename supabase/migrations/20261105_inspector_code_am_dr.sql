-- ✍️ รหัสพนักงานผู้ตรวจบนใบตรวจ AM/PM (DR · "Product DB" eyhclzkifitbhbljgoav · apply แล้ว 05/11 ผ่าน MCP)
-- ประชุม 02/11 C1: เครื่องหน้างานใช้บัญชีกลาง ⇒ inspector_id ไม่ใช่คนตรวจจริง · ตัวตนจริง = รหัสพนักงาน (QR บนบัตร)
-- ใบ export (FM-JIG-003) ใช้รหัสนี้หาชื่อ + ลายเซ็นจากฐานพนักงาน (`inspectorForExport` · src/utils/employeeSignature.js)
-- backward-compatible: คอลัมน์ว่างได้ · ว่าง = พฤติกรรมเดิม (บัญชีที่ login)
-- ↩️ rollback (ย้อนโค้ดก่อน): alter table public.inspections drop column if exists inspector_code;
alter table public.inspections add column if not exists inspector_code text;
comment on column public.inspections.inspector_code is 'รหัสพนักงานผู้ตรวจจริง (สแกนบัตร/พิมพ์) · ว่าง = ใช้บัญชีที่ login (inspector_id)';
-- ตรวจผล: select column_name from information_schema.columns where table_name='inspections' and column_name='inspector_code';
