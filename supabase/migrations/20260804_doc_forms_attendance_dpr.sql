-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- ปิดช่องว่างทะเบียนเอกสาร (QC audit 2026-08-04): เอกสาร export 3 ตัวที่ยังไม่ได้ register
--   1) ใบรายงานการปฏิบัติงานชดเชย / ทำ OT  (Checkin → ส่งออกใบบันทึก หน้าที่ 1)
--   2) DAILY PRODUCTION REPORT              (Daily Report → ใบรายงานประจำกะ)
--   3) รายงาน Daily Report (PDF ภายใน)      (Daily Report → ปุ่ม PDF ของ 4 รายงาน)
-- หน้าที่ 2 ของ Checkin ("บันทึกการมาทำงาน") ใช้ doc_key `attendance_record` ที่ seed ไว้แล้ว
-- (20260730_doc_control_center.sql) — รอบนี้แค่ทำให้โค้ดอ่านค่าจากทะเบียน
--
-- เลขฟอร์ม/Rev ปล่อย null ให้ doc_control เติมเอง — ยังไม่ตั้ง = ใบพิมพ์หน้าตาเดิมเป๊ะ
-- (โค้ดพิมพ์ fallback ค่าเดิมเสมอ และไม่วาดแถบเลขฟอร์มถ้าทะเบียนว่าง)

insert into doc_forms (doc_key, form_code, title, paper, used_route, sig_blocks) values
  ('ot_compensation_report', null, 'ใบรายงานการปฏิบัติงานชดเชย / ทำ OT', 'A4 แนวนอน', '/checkin',
    '["ผู้บันทึก","ผู้ตรวจสอบ","ผู้อนุมัติแผนก","ผู้อนุมัติฝ่าย HRM"]'::jsonb),
  ('daily_production_report', null, 'DAILY PRODUCTION REPORT (ใบรายงานการผลิตประจำกะ)', 'A4 แนวตั้ง', '/daily-report',
    '["ผู้ผลิต (Operator)","หัวหน้างาน (Supervisor)","QA / ผู้ตรวจสอบ"]'::jsonb),
  ('daily_report_export', null, 'รายงาน Daily Report (Kanban / Output / OEE / Downtime)', 'A4 แนวนอน', '/daily-report', null)
on conflict (doc_key) do nothing;

-- เติม legend ให้ "บันทึกการมาทำงาน" (เดิม hardcode ในโค้ด — ย้ายเข้าทะเบียนให้ doc_control แก้เองได้)
update doc_forms set
  paper      = coalesce(paper, 'A4 แนวนอน'),
  used_route = coalesce(used_route, '/checkin'),
  sig_blocks = coalesce(sig_blocks, '["ผู้บังคับบัญชา / หัวหน้างาน","ผู้ตรวจสอบ (HRM)"]'::jsonb),
  legend     = coalesce(legend, 'สัญลักษณ์ :  / = มาทำงาน   ขาด = ขาดงาน   ก = ลากิจ   ป = ลาป่วย   ส = ลาพักร้อน   /OT = ทำ OT ปกติ   /OT+ = ทำ OT ขยาย (23:00 น.)')
where doc_key = 'attendance_record';
