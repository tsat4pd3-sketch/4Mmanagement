-- ทะเบียนเอกสาร — ฟอร์มพิมพ์ MO ของทีม MTN / PRODUCTION (FM-MTN-006) · Main project
-- แยกจาก mo_report (FM-JIG-008 ของ JIG/DIE) เพราะ layout ต่างกัน (คำสั่ง user 2026-07-22)
-- โค้ด printMoReportMtn อ่านผ่าน docFormSync('mo_report_mtn', {fallback}) — ห้าม hardcode เลขฟอร์ม
insert into doc_forms (doc_key, form_code, title, rev, effective_date, paper, used_route, sig_blocks, footer_note) values
  ('mo_report_mtn', 'FM-MTN-006', 'ใบสั่งงานซ่อมบำรุง / Maintenance Order (MTN/PRODUCTION)', null, null, 'A4 แนวตั้ง', '/mtn-repair',
    '["ผู้ตรวจสอบและรับรอง","ผู้อนุมัติ (ผู้จัดการ)"]'::jsonb, 'MAINTENANCE ORDER MO31 08 2015.xls')
on conflict (doc_key) do nothing;
