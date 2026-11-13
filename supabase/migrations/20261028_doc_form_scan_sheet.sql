-- 🗒️ ใบสแกนประจำไลน์ (A4) — เฟส 2 "ทุกอย่างที่ต้องเลือก สแกนได้" (2026-10-28 · คำสั่ง user)
-- project: Main (ewhdfqwfwofivojtsizn · ชื่อในจอ "MAIN")
-- กฎ CLAUDE.md: เอกสาร export ใหม่ทุกตัวต้อง register เข้า /doc-forms · ห้าม hardcode เลขฟอร์ม
-- form_code = null → ยังไม่ตั้งเลขฟอร์มทางการ (doc_control ตั้งเมื่อไหร่ แถบเลขฟอร์มโผล่บนหัวแผ่นเอง)
-- ย้อนกลับ: delete from doc_forms where doc_key = 'scan_sheet';   (ไม่มีตารางอื่นอ้าง)
insert into doc_forms (doc_key, form_code, title, rev, effective_date, paper, used_route, sig_blocks)
values ('scan_sheet', null, 'ใบสแกนประจำไลน์ (QR ไลน์ + ประเภท Downtime + ประเภทงานเสีย)', null, null, 'A4 portrait', '/qr-labels', null)
on conflict (doc_key) do nothing;
