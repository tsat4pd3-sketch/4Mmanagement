-- ทะเบียนเอกสาร: CSV ประวัติการใช้ไฟ (/energy?tab=history · 2026-11-20)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn — additive ล้วน
-- form_code = null โดยตั้งใจ ⇒ ชื่อไฟล์ตามที่โค้ดตั้ง · เลขฟอร์มโผล่เองเมื่อ doc_control ตั้งที่ /doc-forms
insert into doc_forms (doc_key, title, form_code) values
  ('csv_energy_history', 'ประวัติการใช้ไฟรายตู้ — หน่วยไฟต่อช่วง + ค่ารายนาที (CSV)', null)
on conflict (doc_key) do nothing;
-- ตรวจ: select doc_key, title, form_code from doc_forms where doc_key = 'csv_energy_history';
-- ย้อน: delete from doc_forms where doc_key = 'csv_energy_history';
