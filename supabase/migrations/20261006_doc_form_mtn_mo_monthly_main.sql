-- ทะเบียนเอกสาร: สรุปใบแจ้งซ่อม MO รายเดือน (Excel) — รายงานภายใน ยังไม่มีเลขฟอร์มทางการ
-- ★ Apply on Main project ("MAIN" · ewhdfqwfwofivojtsizn) — additive
-- ตามกฎ Doc Control (CLAUDE.md): เอกสาร export ใหม่ทุกตัวต้อง seed แถวใน doc_forms
--   form_code null = ไฟล์หน้าตาเดิม จนกว่า doc_control จะตั้งเลขฟอร์ม/Rev ที่ /doc-forms แล้วโผล่เอง
-- ผู้ใช้: /mtn-repair แท็บ "รายการ MO" → ปุ่ม "⬇️ Excel (รายเดือน)"
-- ที่มา (user 06/10): "ยังไม่มีระบบ export data ของ mo ที่เกิดขึ้นในแต่ละช่วงเดือนออกมาใช่มั้ย"
--   — เดิมมีแต่ `printMoReport` = พิมพ์ใบ**ทีละใบ** (FM-MTN-006 / FM-JIG-008) เอายอดรวมออกไม่ได้

insert into doc_forms (doc_key, title, form_code)
values ('mtn_mo_monthly_export', 'สรุปใบแจ้งซ่อม MO รายเดือน', null)
on conflict (doc_key) do nothing;

-- Rollback: delete from doc_forms where doc_key = 'mtn_mo_monthly_export';
