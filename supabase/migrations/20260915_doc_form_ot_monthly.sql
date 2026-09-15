-- ทะเบียนเอกสาร: สรุป OT รายบุคคลรายเดือน (ส่ง HR) — รายงานภายใน ยังไม่มีเลขฟอร์มทางการ
-- ★ Apply on Main project (ewhdfqwfwofivojtsizn) — additive
-- ตามกฎ Doc Control (CLAUDE.md): เอกสาร export ใหม่ทุกตัวต้อง seed แถวใน doc_forms
-- form_code null = ไฟล์หน้าตาเดิม จนกว่า doc_control จะตั้งเลขฟอร์ม/Rev ที่ /doc-forms แล้วโผล่เอง
-- ผู้ใช้: /workforce-insight แท็บ ⏱️ OT รายบุคคล → ปุ่ม "⬇️ Excel (ฟอร์ม HR)"

insert into doc_forms (doc_key, title, form_code)
values ('ot_monthly_summary', 'ข้อมูลสรุปจำนวน OT พนักงานรายบุคคล', null)
on conflict (doc_key) do nothing;

-- Rollback: delete from doc_forms where doc_key = 'ot_monthly_summary';
