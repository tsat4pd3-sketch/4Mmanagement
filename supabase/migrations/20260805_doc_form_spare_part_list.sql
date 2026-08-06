-- ทะเบียนเอกสาร: รายการอะไหล่สำรอง (Spare part list) — FM-JIG-009
-- ★ Apply on Main project (ewhdfqwfwofivojtsizn) — additive
-- อ้างอิง WI-JIG-010 ข้อ 4 "เอกสารที่เกี่ยวข้อง: FM-JIG-009 Spare part list JIG"
-- ตามกฎ Doc Control: เอกสารพิมพ์ทุกตัวอ่านเลขฟอร์ม/Rev/footer ผ่าน doc_forms
-- (แก้ที่ /doc-forms ได้เลย ไม่ต้องแก้โค้ด) — หน้าพิมพ์ห่อด้วย withDocFoot('spare_part_list')

insert into doc_forms (doc_key, title, form_code, rev, effective_date, paper, used_route)
values ('spare_part_list', 'รายการอะไหล่สำรอง (Spare part list)', 'FM-JIG-009', '00', '07/04/2026', 'A4 landscape', '/mtn-repair')
on conflict (doc_key) do nothing;

-- Rollback: delete from doc_forms where doc_key = 'spare_part_list';
