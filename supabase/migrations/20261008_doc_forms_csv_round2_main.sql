-- ทะเบียนเอกสาร: CSV 14 + Excel 2 ตัวที่เหลือ (QC audit รอบ 3 · 2026-10-08)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn — additive ล้วน
--   **apply จริง 2026-10-08** (เคยค้างไม่ได้ apply: ไฟล์เข้า main 08/10 แต่ฐานยังมี csv 13 แถว
--   ⇒ 12 คีย์ที่โค้ดอ่านไม่มีในทะเบียน = ปุ่ม export ตั้งเลขฟอร์มไม่ได้ · ตรวจเจอ 08/10)
--
-- รอบแรก (20261006_doc_forms_csv_exports.sql) เก็บไป 8 ตัว แต่ **ตกไป 12 ปุ่ม** เพราะ 2 ไฟล์นี้
-- เขียนตัวดาวน์โหลด CSV ของตัวเอง (ก๊อป logic ของ csvDoc.js มาทั้งดุ้น):
--   · src/pages/Report.jsx     `downloadCSV()`  → 10 ปุ่ม
--   · src/pages/DailyReport.jsx `exportCSV()`   →  2 ปุ่ม × 4 ชนิดรายงาน
-- 🔴 `DailyReport.exportCSV` **ไม่มีด่านกัน formula injection** (ต่างจาก Report.jsx ที่มี)
--    ช่อง 'รายละเอียด'/'เครื่องจักร' เป็นข้อความที่หน้างานพิมพ์เอง ⇒ ค่าที่ขึ้นต้นด้วย = + @
--    ถูก Excel รันเป็นสูตรบนเครื่องคนรับไฟล์ · แก้แล้วโดยย้ายไปใช้ `csvCell()` ของกลาง
--
-- 🔴 form_code = null โดยตั้งใจ — วันที่ apply **ชื่อไฟล์เหมือนเดิมทุกตัว ไม่มีอะไรเปลี่ยน**
--    เลขฟอร์มจะโผล่เองเมื่อ doc_control ไปตั้งที่ /doc-forms (หลักเดียวกับ withDocFoot ของใบพิมพ์)

insert into doc_forms (doc_key, title, form_code) values
  -- ── /report (เช็คชื่อ-PPE · 4M · ทักษะ · เบี้ยเลี้ยง) ──────────────────────
  ('csv_ot_bus_booking',      'จองรถรับส่ง OT (CSV)',                     null),
  ('csv_daily_checkin',       'เช็คชื่อ-PPE รายวัน (CSV)',                 null),
  ('csv_employee_month',      'ประวัติเข้างานรายบุคคล รายเดือน (CSV)',      null),
  ('csv_station_attendance',  'เข้างานตามจุดงาน (CSV)',                   null),
  ('csv_attendance_summary',  'สรุป %การมาทำงาน ตามช่วงวันที่ (CSV)',      null),
  ('csv_4m_changes',          'รายการ 4M Change (CSV)',                   null),
  ('csv_skill_matrix',        'ตารางทักษะพนักงาน Skill Matrix (CSV)',      null),
  ('csv_multi_skill',         'ตารางทักษะหลายด้าน Multi-Skill (CSV)',      null),
  ('csv_skill_allowance',     'เบี้ยทักษะรายงวด (CSV)',                   null),
  ('csv_attendance_sheet',    'ใบบันทึกการมาทำงานรายงวด (CSV)',           null),
  -- ── /daily-report แท็บรายงาน (4 ชนิด · ปุ่ม CSV ทั้งในการ์ดและในตัวอย่าง) ──
  ('csv_dr_kanban',           'รายงานคัมบัง/ใบผลิต (CSV)',                null),
  ('csv_dr_output',           'รายงานยอดผลิต (CSV)',                      null),
  ('csv_dr_oee',              'รายงาน OEE รายกะ (CSV)',                   null),
  ('csv_dr_downtime',         'รายงาน Downtime (CSV)',                    null),
  -- ── Excel export 2 ตัวที่ยังไม่เคย register (เลขฟอร์มอยู่ที่ชื่อไฟล์เหมือน CSV) ──────
  ('xlsx_spare_import_template', 'แม่แบบนำเข้าอะไหล่ (Excel)',            null),
  ('xlsx_cqi15_event_log',       'CQI-15 Welding Event Log (Excel)',      null)
on conflict (doc_key) do nothing;

-- ตรวจผล (ควรได้ csv 22 แถว = 8 ของรอบแรก + 14 ของรอบนี้ · xlsx 2 แถว):
--   select count(*) filter (where doc_key like 'csv_%') as csv_keys,
--          count(*) filter (where doc_key like 'xlsx_%') as xlsx_keys from doc_forms;
--   select doc_key, title, form_code, rev from doc_forms where doc_key like 'csv_%' order by doc_key;
--
-- Rollback:
--   delete from doc_forms where doc_key in (
--     'csv_ot_bus_booking','csv_daily_checkin','csv_employee_month','csv_station_attendance',
--     'csv_attendance_summary','csv_4m_changes','csv_skill_matrix','csv_multi_skill',
--     'csv_skill_allowance','csv_attendance_sheet',
--     'csv_dr_kanban','csv_dr_output','csv_dr_oee','csv_dr_downtime',
--     'xlsx_spare_import_template','xlsx_cqi15_event_log');
