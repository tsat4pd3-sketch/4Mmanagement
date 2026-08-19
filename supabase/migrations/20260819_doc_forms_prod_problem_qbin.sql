-- ทะเบียนเอกสาร: ใบรายงานปัญหาการผลิต + บันทึกถังเหลือง/ถังแดง · 2026-08-19
-- ★ Apply on Main project (ewhdfqwfwofivojtsizn) — additive
--
-- ตามกฎ CLAUDE.md: เอกสาร export ใหม่ทุกตัวต้อง seed แถวใน doc_forms
-- ยังไม่มีเลขฟอร์มทางการ → seed form_code = null ไว้ก่อน (หน้าตาเดิมเป๊ะ)
-- doc_control ตั้งเลขฟอร์ม/Rev/ช่องเซ็นเองได้ที่ /doc-forms โดยไม่ต้องแก้โค้ด
--
-- ⚠️ layout_locked = true ทั้ง 3 ใบ — ตารางถังเหลือง/แดงกว้างตามจำนวนคอลัมน์ในฟอร์ม
--    และใบรายงานปัญหาเป็น 3 คอลัมน์ตายตัว เปลี่ยนแนวกระดาษแล้วใบพัง

insert into public.doc_forms (doc_key, title, form_code, rev, paper, paper_size, orientation, layout_locked, used_route, sig_blocks)
values
  ('prod_problem_report', 'ใบรายงานปัญหาการผลิต', null, null,
   'A4 แนวตั้ง', 'A4', 'portrait', true, '/daily-report',
   '["ผู้รายงาน","ผู้ตรวจสอบ","ผู้อนุมัติ"]'::jsonb),
  ('qbin_yellow', 'เอกสารบันทึกรายการชิ้นงานต้องสงสัย (ถังสีเหลือง)', null, null,
   'A4 แนวนอน', 'A4', 'landscape', true, '/qa', '[]'::jsonb),
  ('qbin_red', 'เอกสารบันทึกรายการชิ้นงานเสีย (ถังสีแดง)', null, null,
   'A4 แนวนอน', 'A4', 'landscape', true, '/qa', '[]'::jsonb)
on conflict (doc_key) do nothing;

-- Rollback:
--   delete from public.doc_forms where doc_key in ('prod_problem_report','qbin_yellow','qbin_red');
