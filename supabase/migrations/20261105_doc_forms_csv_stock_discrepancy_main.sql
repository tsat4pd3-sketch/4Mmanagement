-- ทะเบียนเอกสาร: CSV รายงานผลต่างรับ-ส่ง/คลังพัก (2026-11-05 · คำสั่ง user)
-- ★ Apply on MAIN ("MAIN" · ewhdfqwfwofivojtsizn) — additive · form_code = null = ชื่อไฟล์เดิม
insert into doc_forms (doc_key, title, form_code) values
  ('csv_stock_discrepancy', 'รายงานผลต่างรับ-ส่ง / คลังพัก (CSV)', null)
on conflict (doc_key) do nothing;
-- ตรวจผล: select doc_key, title from doc_forms where doc_key = 'csv_stock_discrepancy';
-- Rollback: delete from doc_forms where doc_key = 'csv_stock_discrepancy';
