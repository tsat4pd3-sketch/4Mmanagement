-- ทะเบียนเอกสาร — PE Core Tools: PFMEA (FM-PE1-018) / Control Plan (FM-PE1-019) · Main project
-- 2026-08-17 · คู่กับ src/lib/peExcelExport.js (ปุ่ม "⬇️ ดาวน์โหลด Excel" ใน /pe-docs)
--
-- ทำไมต้อง register: กฎโปรเจค "เอกสาร export ใหม่ทุกตัวต้องเข้าทะเบียน /doc-forms · ห้าม hardcode
-- เลขฟอร์ม/Rev ในโค้ด" — เลขฟอร์มกับ Rev ของ 2 ใบนี้พิมพ์อยู่ท้ายทุกชีทที่ export ออกไป
-- ถ้า doc_control เปลี่ยน Rev ต้องเปลี่ยนได้เองที่ /doc-forms ไม่ต้องรอแก้โค้ด
--
-- ค่าเริ่มต้นยกมาจากท้ายฟอร์มกระดาษจริง (ไฟล์ MB3B-8C306-BE · FMEA Rev.16 / CNP Rev.9):
--   PFMEA        : "FM-PE1-018 Rev.01"  + "Effective Date:24/07/2015"
--   Control Plan : "FM-PE1-019 Rev.01"  + "Effective Date : 24/07/2015"
-- (Rev.01 = เวอร์ชันของ "แบบฟอร์ม" ไม่ใช่ Rev ของเอกสารรายพาร์ท ซึ่งอยู่ที่ pe_doc_revisions)
--
-- ⚠️ layout_locked = true ทั้งคู่ — ตัวสร้างไฟล์ล็อก A4 แนวนอน + ความกว้างคอลัมน์ตามฟอร์มจริง
--    (PFMEA 19 คอลัมน์ · CP 14 คอลัมน์) เปลี่ยนแนวกระดาษแล้วตารางล้นหน้าทันที
-- ⚠️ ไม่ตั้ง sig_blocks — 2 ใบนี้ไม่มีแถบช่องลายเซ็นท้ายฟอร์มแบบใบอื่น
--    ผู้จัดทำ/ตรวจ/อนุมัติ อยู่ในหัวเอกสาร และมาจาก pe_doc_revisions (ต่อ revision) ไม่ใช่ค่าคงที่ของฟอร์ม

-- pe_pfc = ใบพิมพ์ "ผังกระบวนการที่ระบบวาดจากรายการ OP" (src/lib/pePfcPrint.js)
--   เลขฟอร์ม FM-PE1-020 Rev.01 / Effective 17/03/2015 ยกจาก footer ของไฟล์ PFC จริง
--   ⚠️ ใบนี้ไม่ใช่ไฟล์ PFC ต้นฉบับ (ต้นฉบับเป็นผังวาดมือใน Excel) — บนใบมีข้อความกำกับไว้แล้ว
--   layout_locked = false : ผังเป็น SVG สเกลตาม viewBox → เปลี่ยน A3↔A4 / แนวกระดาษ แล้วมีผลจริง
insert into doc_forms (doc_key, form_code, title, rev, effective_date, paper, paper_size, orientation, layout_locked, used_route, sig_blocks)
values
  ('pe_fmea', 'FM-PE1-018', 'Process FMEA (Potential Failure Mode and Effects Analysis)',
   'Rev.01', '24/07/2015', 'A4 แนวนอน', 'A4', 'landscape', true, '/pe-docs', null),
  ('pe_cp', 'FM-PE1-019', 'Control Plan',
   'Rev.01', '24/07/2015', 'A4 แนวนอน', 'A4', 'landscape', true, '/pe-docs', null),
  ('pe_pfc', 'FM-PE1-020', 'ผังกระบวนการผลิต (Process Flow Chart)',
   'Rev.01', '17/03/2015', 'A3 แนวนอน', 'A3', 'landscape', false, '/pe-docs',
   '["Issued By","Checked By","Approved By"]'::jsonb)
on conflict (doc_key) do nothing;
