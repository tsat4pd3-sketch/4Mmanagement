-- ทะเบียนเอกสาร: CSV ประวัติ Transaction สต็อกในไลน์ (2026-11-04 · คำสั่ง user "ควรมี export data")
-- ★ Apply on MAIN ("MAIN" · ewhdfqwfwofivojtsizn) — additive ล้วน · form_code = null = ชื่อไฟล์เดิม จนกว่า doc_control ตั้งเลข
insert into doc_forms (doc_key, title, form_code) values
  ('csv_line_stock_txn', 'ประวัติ Transaction สต็อกในไลน์ (CSV)', null)
on conflict (doc_key) do nothing;
-- ตรวจผล: select doc_key, title, form_code from doc_forms where doc_key = 'csv_line_stock_txn';
-- Rollback: delete from doc_forms where doc_key = 'csv_line_stock_txn';
