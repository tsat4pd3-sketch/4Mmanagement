-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn)
-- 🧹 ถอนคีย์ doc_forms ที่ซ้ำซ้อน — 2 session แก้เรื่องเดียวกันคนละชื่อคีย์ (2026-10-08)
--
-- ที่มา: QC audit 08/10 ชี้ว่า CSV ของ `/report` + `/daily-report` ไม่เข้าทะเบียน
--   **2 session แก้พร้อมกัน** · ของที่เข้า main ก่อน (`20261008_doc_forms_csv_round2_main.sql`)
--   ละเอียดกว่า — แยก `/daily-report` เป็น 4 คีย์ตามชนิดรายงาน (kanban/output/oee/downtime)
--   และคลุม CQI-15 Excel ด้วย ⇒ **ยกของ main เป็นตัวจริง** แล้วถอนคีย์ของอีกชุดออก
--
-- 🔴 ทำไมต้องถอน ไม่ใช่ปล่อยไว้: คีย์ที่ไม่มีโค้ดอ่าน = "คีย์ไร้ปุ่ม" — โผล่ใน `/doc-forms`
--    ให้ doc_control ตั้งเลขฟอร์ม/Rev ได้ แต่ไม่มีไฟล์ไหนใช้ค่านั้น
--    ⇒ ตั้งแล้วไม่เห็นผล + มี 2 แถวของรายงานเดียวกันให้เลือกผิด (อาการเดียวกับที่ audit เองจับ)
--
-- ⚠️ ปลอดภัย: ไม่มีโค้ดบรรทัดใดอ้าง 12 คีย์นี้ (ตรวจด้วย grep แล้ว) · ตารางนี้เก็บแค่
--    เลขฟอร์ม/Rev/ลายเซ็น ไม่มีข้อมูลธุรกิจ · ถอนแล้วชื่อไฟล์ export ไม่เปลี่ยน
--    (ตัวที่ใช้จริงคือคีย์ของ main ซึ่งยังอยู่ครบ)
-- ════════════════════════════════════════════════════════════════════════════

delete from doc_forms where doc_key in (
  'csv_ot_booking', 'csv_report_daily', 'csv_report_employee', 'csv_report_station',
  'csv_report_summary', 'csv_daily_report', 'xlsx_spare_template'
)
-- 🔴 เงื่อนไขกันพลาด: ถอนได้เฉพาะแถวที่ **ยังไม่มีใครตั้งเลขฟอร์ม/Rev** (= ไม่มีใครใช้จริง)
--    ถ้า doc_control เผลอไปตั้งค่าไว้แล้ว แถวนั้นจะไม่ถูกลบ ให้คนมาตัดสินเอง
  and coalesce(form_code, '') = '' and coalesce(rev, '') = '';

-- ⚠️ `csv_4m_changes` · `csv_skill_matrix` · `csv_multi_skill` · `csv_skill_allowance` · `csv_attendance`
--    **ห้ามลบ** — 4 ตัวแรกชื่อตรงกับที่ main ใช้อยู่ (on conflict do nothing ⇒ แถวเดียวกัน)
--    ส่วน `csv_attendance` main ใช้ชื่อ `csv_attendance_sheet` แต่ปล่อยไว้ไม่เสียหาย
--    (เผื่อ doc_control เคยเห็นแล้ว) — ถ้าจะเก็บกวาดต่อ ให้ user ตัดสิน

-- ✅ ตรวจผล (project "MAIN" · ewhdfqwfwofivojtsizn)
--   select doc_key, title, form_code, rev from doc_forms where doc_key like 'csv_%' or doc_key like 'xlsx_%'
--    order by doc_key;
--   -- ต้องเหลือชุดของ 20261008_doc_forms_csv_round2_main.sql + csv รอบ 06/10 เท่านั้น
--
-- ⏪ ROLLBACK: insert กลับด้วยไฟล์ที่ถูกถอน (ดูประวัติ git — คอมมิทนี้ลบไฟล์
--    `20261008_doc_forms_csv_report_dailyreport_main.sql` ออกเพราะซ้ำซ้อน)
