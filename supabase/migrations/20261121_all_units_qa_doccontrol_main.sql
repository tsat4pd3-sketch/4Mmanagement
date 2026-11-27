-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- 🔐 คืนใบผ่านข้ามหน่วย (profiles.all_units) ให้ QA + document_control รายคน — hotfix เสาร์ 21/11 09:20
--
-- ที่มา: หน้างานแจ้ง (สุริยา · QA) "ตั้งค่าใบตรวจ/ทะเบียนพาร์ท: เป็นของหน่วยงานอื่น แก้ไขไม่ได้"
--   · ก่อน 20/11 role qa (19) + document_control (2) ได้ `scope:all_units` ผ่าน role (archive.bk_role_scope_20261113)
--   · migration 20261113 ถอดคีย์ role แล้วให้ all_units รายคน 12 บัญชี — **ไม่ได้รวม QA/เอกสาร** เพราะเชื่อว่า
--     `qaWriteCtx()` (src/utils/qaViewScope.js) จะให้ QA เป็น all-units บนจอคุณภาพเอง
--   · แต่เงื่อนไขของ qaWriteCtx คือ "บ้าน QA ไม่มีไลน์ในทะเบียน" — ตั้งแต่ 05/11 หน่วยสนับสนุนอยู่ในทะเบียนไลน์แล้ว
--     (QA · Inspection · PQA-Press … unit_kind='support') ⇒ QA "มีไลน์" ⇒ ไม่ได้ยกเว้น ⇒ ถูกด่านหน่วยบล็อก
-- กฎ: งานของ QA/เอกสาร = ข้ามไลน์ทั้งโรงงานโดยธรรมชาติ ⇒ ใบผ่านรายคน (ตามแบบ 13/11) ไม่ใช่คืนคีย์ role
-- ย้อนกลับ: update public.profiles set all_units = false where role in ('qa','document_control');

update public.profiles set all_units = true
where role::text in ('qa', 'document_control') and all_units = false;

-- ตรวจ: select role, count(*) filter (where all_units) pass, count(*) n from profiles group by 1;  -- qa 19/19 · document_control 2/2
