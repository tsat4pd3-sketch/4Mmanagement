-- Main project (ewhdfqwfwofivojtsizn · "MAIN") — 2026-10-20 · user ส่งฟอร์มจริง FM-MTN-005
-- ทะเบียนเอกสาร: ใบบันทึกประวัติการซ่อมและการทำ PM MACHINE (Excel export จาก "📜 ประวัติซ่อม" รายเครื่อง)
-- ค่าตามใบกระดาษ: FM-MTN-005 · ออกครั้งที่ A (เก็บใน notes — ไม่มีคอลัมน์) · วันที่ออกใช้ 31/08/2015 · แก้ไขครั้งที่ 02 · A4 แนวนอน
-- ✅ apply แล้ว 20/10 ผ่าน MCP · ผู้ใช้: /equipment → แท็บเครื่องจักร → 📜 ประวัติซ่อม → ⬇️ Excel (FM-MTN-005)
insert into doc_forms (doc_key, title, form_code, rev, paper, paper_size, orientation, effective_date, notes, used_route, layout_locked, is_active)
values ('mtn_machine_history', 'ใบบันทึกประวัติการซ่อมและการทำ PM MACHINE', 'FM-MTN-005', '02', 'A4 แนวนอน', 'A4', 'landscape', '31/08/2015',
        'ออกครั้งที่ A · export จาก /equipment (ประวัติซ่อมรายเครื่อง)', '/equipment', true, true)
on conflict (doc_key) do nothing;
-- Rollback: delete from doc_forms where doc_key = 'mtn_machine_history';
