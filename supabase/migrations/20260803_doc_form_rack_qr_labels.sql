-- ทะเบียนเอกสาร: แผ่นป้าย QR เรียกภาชนะ (Rack Center) — รายงานภายใน ยังไม่มีเลขฟอร์มทางการ
-- ★ Apply on Main project (ewhdfqwfwofivojtsizn) — additive
-- ตามกฎ Doc Control: เอกสารพิมพ์ใหม่ทุกตัว seed แถวใน doc_forms (form_code null = หน้าตาเดิม
-- จนกว่า doc_control จะตั้งเลขฟอร์มที่ /doc-forms แล้วแถบเลขฟอร์มโผล่เองผ่าน withDocFoot)

insert into doc_forms (doc_key, title, form_code)
values ('rack_qr_labels', 'ป้าย QR เรียกภาชนะ (Rack Center)', null)
on conflict (doc_key) do nothing;

-- Rollback: delete from doc_forms where doc_key = 'rack_qr_labels';
