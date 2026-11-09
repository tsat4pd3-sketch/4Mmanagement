-- ทะเบียนเอกสาร: Excel "ทะเบียนแม่พิมพ์" (/equipment?tab=die · ปุ่ม 📥 Export Excel · คำสั่ง user 05/11
--   "ให้มี export excel ในหน้าทะเบียน เพื่อให้ทีม export ไปไล่ข้อมูล")
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn — additive ล้วน (insert 1 แถว)
-- โค้ดทำงานได้ทั้งก่อน/หลัง apply: ก่อน = `docFormSync` คืน fallback ⇒ ชื่อไฟล์ `die_registry.xlsx` (ไม่ล้ม)
-- 🔴 form_code = null โดยตั้งใจ — วันที่ apply ชื่อไฟล์ยังเหมือนเดิม · doc_control ตั้งเลขฟอร์มที่ /doc-forms ได้เอง

insert into doc_forms (doc_key, title, form_code, used_route) values
  ('xlsx_die_registry', 'ทะเบียนแม่พิมพ์ — ราย OP + ชุด (Excel)', null, '/equipment')
on conflict (doc_key) do nothing;

-- ตรวจผล (ควรได้ 1 แถว · form_code ว่าง):
--   select doc_key, title, form_code, rev, used_route from doc_forms where doc_key = 'xlsx_die_registry';
--
-- Rollback:
--   delete from doc_forms where doc_key = 'xlsx_die_registry';
