-- ── Main project ──
-- FM-JIG-008: ป้ายช่องลายเซ็นช่องแรกในฟอร์มกระดาษต้นฉบับคือ "JIG APPROVE" (ไม่ใช่ "JIG/MTN APPROVE")
-- seed เดิม (20260720_doc_forms_sig_blocks.sql) ใส่ค่าที่ไม่ตรงฟอร์มจริงไว้ — แก้ให้ตรงต้นฉบับ
-- แก้เฉพาะแถวที่ยังเป็นค่า seed เดิมเป๊ะ (ถ้า doc_control แก้เองไปแล้วจะไม่ทับ)
update doc_forms
   set sig_blocks = '["JIG APPROVE","QA APPROVE","PD APPROVE","MGR APPROVE"]'::jsonb
 where doc_key = 'mo_report'
   and sig_blocks = '["JIG/MTN APPROVE","QA APPROVE","PD APPROVE","MGR APPROVE"]'::jsonb;
