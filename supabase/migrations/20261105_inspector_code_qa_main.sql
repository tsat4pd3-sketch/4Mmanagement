-- ✍️ รหัสพนักงานผู้ตรวจบนใบตรวจ QA (Main · "MAIN" ewhdfqwfwofivojtsizn · apply แล้ว 05/11 ผ่าน MCP)
-- ประชุม 02/11 C1 — เหตุผลเดียวกับ inspections.inspector_code (DR) · ใบพิมพ์ QA ยังไม่มี (เก็บรหัสไว้ก่อน)
-- backward-compatible: คอลัมน์ว่างได้ · RLS/GRANT เดิมของตารางครอบ (update ทั้งแถวอยู่แล้ว)
-- ↩️ rollback (ย้อนโค้ดก่อน): alter table public.qa_inspection_sheets drop column if exists inspector_code;
alter table public.qa_inspection_sheets add column if not exists inspector_code text;
comment on column public.qa_inspection_sheets.inspector_code is 'รหัสพนักงานผู้ตรวจจริง (สแกนบัตร/พิมพ์) · ว่าง = ใช้ inspector_name/uid เดิม';
-- ตรวจผล: select column_name from information_schema.columns where table_name='qa_inspection_sheets' and column_name='inspector_code';
