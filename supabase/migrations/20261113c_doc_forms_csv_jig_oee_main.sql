-- ทะเบียนเอกสาร: CSV รายงาน OEE รายจิ๊ก (/oee-analytics?tab=machine · 2026-11-13)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn — additive ล้วน
-- form_code = null โดยตั้งใจ ⇒ ชื่อไฟล์ตามที่โค้ดตั้ง · เลขฟอร์มโผล่เองเมื่อ doc_control ตั้งที่ /doc-forms
insert into doc_forms (doc_key, title, form_code) values
  ('csv_jig_oee_shift', 'รายงาน OEE รายจิ๊ก/เครื่อง รายกะ — ข้อมูลจากเครื่อง (CSV)', null)
on conflict (doc_key) do nothing;
-- ตรวจ: select doc_key, title, form_code from doc_forms where doc_key = 'csv_jig_oee_shift';
-- ย้อน: delete from doc_forms where doc_key = 'csv_jig_oee_shift';
