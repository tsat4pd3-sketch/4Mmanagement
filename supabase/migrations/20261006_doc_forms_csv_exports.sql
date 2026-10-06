-- ทะเบียนเอกสาร: CSV export 8 ตัวที่ยังไม่เคย register (QC audit 2026-10-06 · คำสั่ง user)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn — additive ล้วน
--
-- ทำไม: CLAUDE.md §doc-forms เขียนว่า "ฟอร์มพิมพ์/PDF/Excel/รายงานภายใน — ไม่มีข้อยกเว้น"
--        แต่ CSV dump ถูกมองข้ามมาตลอดเพราะไม่มีหัวกระดาษให้ใส่เลขฟอร์ม
--        ⇒ เลขฟอร์ม/Rev ของ CSV ไปอยู่ที่ "ชื่อไฟล์" (src/utils/csvDoc.js) ห้ามแทรกในเนื้อไฟล์
--
-- 🔴 form_code = null โดยตั้งใจ — วันที่ apply **ชื่อไฟล์เหมือนเดิมทุกตัว ไม่มีอะไรเปลี่ยน**
--    เลขฟอร์มจะโผล่เองเมื่อ doc_control ไปตั้งที่ /doc-forms (หลักเดียวกับ withDocFoot ของใบพิมพ์)

insert into doc_forms (doc_key, title, form_code) values
  ('csv_manpower_daily',    'กำลังคนรายวัน (CSV)',                     null),
  ('csv_station_moves',     'การเปลี่ยนจุดงาน (CSV)',                   null),
  ('csv_ot_individual',     'OT รายบุคคล (CSV)',                       null),
  ('csv_heijunka_kanban',   'ลำดับการผลิต/คัมบัง Heijunka (CSV)',       null),
  ('csv_kanban_calc',       'ผลคำนวณจำนวนคัมบัง (CSV)',                null),
  ('csv_product_master',    'ข้อมูลทะเบียนสินค้า/พาร์ท (CSV)',          null),
  ('csv_product_template',  'แม่แบบนำเข้าสินค้า (CSV)',                 null),
  ('csv_parts_template',    'แม่แบบนำเข้าพาร์ท/วัตถุดิบ (CSV)',          null)
on conflict (doc_key) do nothing;

-- ตรวจผล:
--   select doc_key, title, form_code, rev from doc_forms where doc_key like 'csv_%' order by doc_key;
-- Rollback:
--   delete from doc_forms where doc_key in ('csv_manpower_daily','csv_station_moves','csv_ot_individual',
--     'csv_heijunka_kanban','csv_kanban_calc','csv_product_master','csv_product_template','csv_parts_template');
