-- ทะเบียนเอกสาร: 3 ฟอร์มของไฟล์ Excel KPI (QC audit 2026-10-06)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn
--
-- 🔴 `src/lib/kpiExportExcel.js` เขียนกฎไว้ในหัวไฟล์เองว่า "เลขฟอร์ม/Rev อ่านจากทะเบียน
--    doc_forms (doc_key: kpi_monthly) — ห้าม hardcode" แล้ว **ยัง hardcode ทั้ง 3 ที่**
--    (FM-HRM-6-022 / FM-HRM-6-024(01) / FM-HRM-6-025(01) — ทั้งในหัวตารางและในชื่อชีท)
--    ต้นเหตุ: 3 ชีท = **3 ฟอร์มคนละเลข** แต่มี doc_key เดียว ⇒ ใส่ลงทะเบียนไม่ได้ตั้งแต่แรก
--    ⇒ doc_control เปลี่ยนเลขฟอร์ม/Rev เองไม่ได้ ต้องให้คนแก้โค้ด (ผิดกฎ doc-forms ใน CLAUDE.md)
--
-- ✅ `kpi_monthly` **คงไว้เหมือนเดิม** — ตัวนั้นเป็น "ใบพิมพ์" ของหน้า /obeya?tab=kpi (คนละใบกับ Excel)
--
-- ⚠️ ค่า form_code ที่ seed = **เลขที่ใช้อยู่จริงวันนี้** (ถอดจากไฟล์ KPI FY2023 ของบริษัท)
--    ⇒ ก่อนที่ doc_control จะแก้ ไฟล์ที่ export ออกมาเหมือนเดิมเป๊ะ ไม่มี behavior change
--    (ต่างจาก migration CSV 06/10 ที่ seed form_code = null เพราะ "ยังไม่มีเลขฟอร์มจริง")

insert into public.doc_forms (doc_key, title, form_code, rev, is_active) values
  ('kpi_appraisal',  'KPI Appraisal Form (ชีท 1 ของไฟล์ Excel KPI)', 'FM-HRM-6-022',     null, true),
  ('kpi_monitoring', 'KPI Monitoring (ชีท 2 ของไฟล์ Excel KPI)',     'FM-HRM-6-024(01)', null, true),
  ('kpi_action',     'KPI Action Plan (ชีท 3 ของไฟล์ Excel KPI)',    'FM-HRM-6-025(01)', null, true)
on conflict (doc_key) do nothing;   -- รันซ้ำได้ · ของที่ doc_control แก้แล้วห้ามทับ

-- ตรวจผล:
--   select doc_key, form_code, rev, is_active from public.doc_forms
--   where doc_key like 'kpi%' order by doc_key;
-- Rollback:
--   delete from public.doc_forms where doc_key in ('kpi_appraisal','kpi_monitoring','kpi_action');
--   (โค้ดมี fallback เป็นเลขเดิมอยู่แล้ว — ลบทะเบียนออกก็ยัง export ได้เลขเดิม)
