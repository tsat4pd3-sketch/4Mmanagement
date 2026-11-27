-- ทะเบียนเอกสาร: CSV ประวัติเบิก-ส่ง ไลน์ ↔ สโตร์ (2026-11-27 · คำสั่ง user "dashboard transaction กดเบิกอะไร สโตร์ส่งอะไร")
-- ★ Apply on MAIN ("MAIN" · ewhdfqwfwofivojtsizn) — additive ล้วน · form_code = null = ชื่อไฟล์เดิม จนกว่า doc_control ตั้งเลข
insert into doc_forms (doc_key, title, form_code) values
  ('csv_line_request_history', 'ประวัติเบิก-ส่ง ไลน์ ↔ สโตร์ (CSV)', null)
on conflict (doc_key) do nothing;
-- ตรวจผล: select doc_key, title, form_code from doc_forms where doc_key = 'csv_line_request_history';
-- Rollback: delete from doc_forms where doc_key = 'csv_line_request_history';
