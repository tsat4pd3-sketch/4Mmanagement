-- ── Main project ──
-- เติม sig_blocks (ข้อความช่องลายเซ็น) ให้ฟอร์มที่ wire เพิ่ม: multi_skill / individual_skill / mo_report
-- (ค่าตรงกับ default ในโค้ด — แก้จากหน้า /doc-forms ได้เลย)
update doc_forms set sig_blocks = '["จัดทำโดย","ตรวจสอบโดย","อนุมัติโดย"]'::jsonb
  where doc_key = 'multi_skill' and sig_blocks is null;
update doc_forms set sig_blocks = '["พนักงานผู้ถูกประเมิน","ผู้ประเมิน","ผู้รับรอง"]'::jsonb
  where doc_key = 'individual_skill' and sig_blocks is null;
update doc_forms set sig_blocks = '["JIG/MTN APPROVE","QA APPROVE","PD APPROVE","MGR APPROVE"]'::jsonb
  where doc_key = 'mo_report' and sig_blocks is null;
