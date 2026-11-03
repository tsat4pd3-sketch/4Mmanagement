-- ทะเบียนเอกสาร: Excel "รายงาน AM รายเดือน" (/daily-checker?tab=pm&sub=monthly · ประชุม 02/11 ข้อ C2)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn — additive ล้วน (insert 1 แถว)
-- ⚠️ ยังไม่ apply (2026-11-03) — โค้ดทำงานได้ทั้งก่อน/หลัง apply:
--    ก่อน apply = `docFormSync` คืน fallback ⇒ ชื่อไฟล์ `AM_Monthly_<เดือน>_<กะ>.xlsx` (ไม่ล้ม)
--    หลัง apply = doc_control ตั้งเลขฟอร์มได้ที่ /doc-forms ⇒ เลขฟอร์ม/Rev ไปอยู่หน้าชื่อไฟล์เอง
-- 🔴 form_code = null โดยตั้งใจ — วันที่ apply ชื่อไฟล์ยังเหมือนเดิม (หลักเดียวกับ 20261008_doc_forms_csv_round2_main.sql)

insert into doc_forms (doc_key, title, form_code) values
  ('xlsx_am_monthly', 'รายงาน AM (Autonomous Maintenance) รายเดือน (Excel)', null)
on conflict (doc_key) do nothing;

-- ตรวจผล (ควรได้ 1 แถว · form_code ว่าง):
--   select doc_key, title, form_code, rev from doc_forms where doc_key = 'xlsx_am_monthly';
--
-- Rollback:
--   delete from doc_forms where doc_key = 'xlsx_am_monthly';
