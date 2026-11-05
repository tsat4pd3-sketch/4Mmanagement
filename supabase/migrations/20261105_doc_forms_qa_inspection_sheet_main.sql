-- ทะเบียนเอกสาร: ใบตรวจตามมาตรฐาน QA (Inspection Check Sheet) — ปุ่ม 🖨️ ใน /qa แท็บใบตรวจ (src/lib/qaSheetPrint.js)
-- ★ MAIN ("MAIN" · ewhdfqwfwofivojtsizn) · apply แล้ว 05/11 ผ่าน MCP · additive ล้วน (insert 1 แถว)
-- form_code = null โดยตั้งใจ — doc_control ตั้งเลขฟอร์ม/Rev/ช่องเซ็นที่ /doc-forms เอง (ห้าม hardcode)
insert into doc_forms (doc_key, title, form_code) values
  ('qa_inspection_sheet', 'ใบตรวจตามมาตรฐาน QA (Inspection Check Sheet)', null)
on conflict (doc_key) do nothing;
-- ตรวจผล: select doc_key, title, form_code from doc_forms where doc_key = 'qa_inspection_sheet';
-- Rollback: delete from doc_forms where doc_key = 'qa_inspection_sheet';
