-- ทะเบียนเอกสาร — ใบรายงานของเสีย FM-PD2-002 Rev.06 (Scrap Report) · Main project
-- เดิม scrapExportExcel.js hardcode เลขฟอร์ม + ป้ายช่องอนุมัติ 5 ช่อง (ขัดกฎ "ฟอร์มพิมพ์ใหม่ทุกตัวต้อง register")
-- โค้ด export อ่านผ่าน getDocForm('scrap_report', {fallback}) — แก้เลขฟอร์ม/Rev/ป้ายลายเซ็นที่ /doc-forms ได้เอง
-- sig_blocks = ป้ายกำกับใต้ชื่อผู้เซ็น 5 ช่อง (ตรงกับ layout เดิม จำนวนต้องเท่ากัน เปลี่ยนได้เฉพาะข้อความ):
--   [ผู้ตรวจสอบ, ผู้ขออนุมัติ, ผู้อนุมัติ QA, ผู้อนุมัติผลิต, ผู้อนุมัติ GM]
insert into doc_forms (doc_key, form_code, title, rev, effective_date, paper, used_route, sig_blocks) values
  ('scrap_report', 'FM-PD2-002', 'ใบรายงานของเสีย (SCRAP REPORT)', 'Rev.06', null, 'A4 แนวตั้ง', '/scrap-report',
    '["พนักงาน QC","หัวหน้าแผนก","ผู้จัดการ QA/QC","ผู้จัดการผลิต","ผู้จัดการทั่วไป"]'::jsonb)
on conflict (doc_key) do nothing;
